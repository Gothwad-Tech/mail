// =============================================================================
// Mail domain logic: validation, row <-> API mapping, and scoped queries.
//
// Rule for every function here: take `username` from the VERIFIED session and
// put it in the query. A user can only ever see rows where to_username matches
// their own username. Sent mail is stored with to_username = sender, so the
// same rule covers Inbox, Sent, Drafts and Trash.
// =============================================================================

import type { Db } from './db';
import { HttpError } from './http';

export type Folder = 'inbox' | 'starred' | 'sent' | 'drafts' | 'trash';
const FOLDERS: readonly Folder[] = ['inbox', 'starred', 'sent', 'drafts', 'trash'];

export interface AttachmentMeta {
  name: string;
  type: string;
  size: number;
}

/** Row shape as stored in public.mail_messages (only the columns we read). */
export interface MailRow {
  id: string;
  folder: 'inbox' | 'sent' | 'drafts' | 'trash';
  from_email: string;
  from_name: string | null;
  to_email: string | null;
  cc_emails: string[] | null;
  bcc_emails: string[] | null;
  subject: string | null;
  snippet: string | null;
  attachments: AttachmentMeta[] | null;
  is_read: boolean;
  is_starred: boolean;
  received_at: string;
  body_text?: string | null;
  body_html?: string | null;
}

/** What the browser gets. Camel-case, no DB column names leak out. */
export interface MessageDto {
  id: string;
  folder: 'inbox' | 'sent' | 'drafts' | 'trash';
  from: { name: string | null; email: string };
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  snippet: string;
  receivedAt: string;
  isRead: boolean;
  isStarred: boolean;
  attachments: AttachmentMeta[];
  bodyText?: string;
  bodyHtml?: string | null;
}

export const LIST_COLUMNS =
  'id,folder,from_email,from_name,to_email,cc_emails,bcc_emails,subject,snippet,attachments,is_read,is_starred,received_at';
export const DETAIL_COLUMNS = `${LIST_COLUMNS},body_text,body_html`;

export const MAX_RECIPIENTS = 25;
export const MAX_SUBJECT_CHARS = 255;
export const MAX_BODY_CHARS = 100_000;
export const MAX_STORED_HTML_CHARS = 500_000;
const SNIPPET_CHARS = 160;

const EMAIL_RE = /^[^\s@<>,;"']+@[^\s@<>,;"']+\.[^\s@<>,;"']+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseFolder(raw: string | null): Folder {
  if (raw === null || raw === '') return 'inbox';
  if ((FOLDERS as readonly string[]).includes(raw)) return raw as Folder;
  throw new HttpError(400, 'bad_folder', `folder must be one of: ${FOLDERS.join(', ')}`);
}

export function parseId(raw: string): string {
  if (!UUID_RE.test(raw)) throw new HttpError(400, 'bad_id', 'Message id is not valid.');
  return raw;
}

export function cleanRecipients(list: unknown, field: 'to' | 'cc' | 'bcc'): string[] {
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list)) throw new HttpError(400, 'bad_recipients', `${field} must be a list.`);
  const out: string[] = [];
  for (const item of list) {
    if (typeof item !== 'string') throw new HttpError(400, 'bad_recipients', `${field} must be strings.`);
    const addr = item.trim().toLowerCase();
    if (!addr) continue;
    if (addr.length > 254 || !EMAIL_RE.test(addr)) {
      throw new HttpError(400, 'invalid_recipient', `Invalid email address in ${field}.`);
    }
    if (!out.includes(addr)) out.push(addr);
  }
  return out;
}

export function cleanSubject(raw: unknown): string {
  if (raw === undefined || raw === null) return '';
  if (typeof raw !== 'string') throw new HttpError(400, 'bad_subject', 'subject must be text.');
  // Strip CR/LF so a subject can never inject headers.
  const s = raw.replace(/[\r\n]+/g, ' ').trim();
  if (s.length > MAX_SUBJECT_CHARS) throw new HttpError(400, 'subject_too_long', 'Subject is too long.');
  return s;
}

export function cleanBody(raw: unknown): string {
  if (raw === undefined || raw === null) return '';
  if (typeof raw !== 'string') throw new HttpError(400, 'bad_body', 'body must be text.');
  if (raw.length > MAX_BODY_CHARS) throw new HttpError(413, 'body_too_long', 'Message body is too long.');
  return raw;
}

export function checkRecipientCount(to: string[], cc: string[], bcc: string[]): void {
  if (to.length + cc.length + bcc.length > MAX_RECIPIENTS) {
    throw new HttpError(400, 'too_many_recipients', `At most ${MAX_RECIPIENTS} recipients per message.`);
  }
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Plain text -> safe HTML. Escapes first, so user text can never inject markup. */
export function textToHtml(text: string): string {
  return escapeHtml(text).replace(/\r\n|\r|\n/g, '<br>');
}

export function makeSnippet(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > SNIPPET_CHARS ? `${collapsed.slice(0, SNIPPET_CHARS - 1)}…` : collapsed;
}

function splitList(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function toDto(row: MailRow, withBody: boolean): MessageDto {
  const dto: MessageDto = {
    id: row.id,
    folder: row.folder,
    from: { name: row.from_name, email: row.from_email },
    to: splitList(row.to_email),
    cc: row.cc_emails ?? [],
    bcc: row.bcc_emails ?? [],
    subject: row.subject ?? '',
    snippet: row.snippet ?? '',
    receivedAt: row.received_at,
    isRead: row.is_read,
    isStarred: row.is_starred,
    attachments: row.attachments ?? [],
  };
  if (withBody) {
    dto.bodyText = row.body_text ?? '';
    dto.bodyHtml = row.body_html ?? null;
  }
  return dto;
}

// ---------------------------------------------------------------------------
// Scoped queries
// ---------------------------------------------------------------------------

export interface ListOptions {
  folder: Folder;
  limit: number;
  before: string | null;
}

export function parseListOptions(url: URL): ListOptions {
  const folder = parseFolder(url.searchParams.get('folder'));
  const rawLimit = Number.parseInt(url.searchParams.get('limit') || '50', 10);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 100) : 50;
  const before = url.searchParams.get('before');
  if (before !== null && Number.isNaN(Date.parse(before))) {
    throw new HttpError(400, 'bad_before', 'before must be an ISO date.');
  }
  return { folder, limit, before };
}

export async function listMessages(db: Db, username: string, opts: ListOptions): Promise<MessageDto[]> {
  const query: Record<string, string> = {
    select: LIST_COLUMNS,
    to_username: `eq.${username}`,
    order: 'received_at.desc',
    limit: String(opts.limit),
  };
  if (opts.folder === 'starred') {
    query.is_starred = 'eq.true';
    query.folder = 'in.(inbox,sent)';
  } else {
    query.folder = `eq.${opts.folder}`;
  }
  if (opts.before) query.received_at = `lt.${new Date(opts.before).toISOString()}`;

  const rows = await db.select<MailRow>('mail_messages', query);
  return rows.map((r) => toDto(r, false));
}

export async function getMessage(db: Db, username: string, id: string): Promise<MessageDto> {
  const rows = await db.select<MailRow>('mail_messages', {
    select: DETAIL_COLUMNS,
    id: `eq.${id}`,
    to_username: `eq.${username}`,
    limit: '1',
  });
  if (!rows[0]) throw new HttpError(404, 'not_found', 'Message not found.');
  return toDto(rows[0], true);
}

export interface PatchInput {
  isRead?: boolean;
  isStarred?: boolean;
  moveToTrash?: boolean;
}

export function parsePatch(body: unknown): PatchInput {
  if (!body || typeof body !== 'object') throw new HttpError(400, 'bad_body', 'Body must be an object.');
  const b = body as Record<string, unknown>;
  const out: PatchInput = {};
  for (const key of Object.keys(b)) {
    if (!['isRead', 'isStarred', 'moveToTrash'].includes(key)) {
      throw new HttpError(400, 'bad_field', `Field "${key}" cannot be changed.`);
    }
  }
  if (b.isRead !== undefined) {
    if (typeof b.isRead !== 'boolean') throw new HttpError(400, 'bad_field', 'isRead must be boolean.');
    out.isRead = b.isRead;
  }
  if (b.isStarred !== undefined) {
    if (typeof b.isStarred !== 'boolean') throw new HttpError(400, 'bad_field', 'isStarred must be boolean.');
    out.isStarred = b.isStarred;
  }
  if (b.moveToTrash !== undefined) {
    if (b.moveToTrash !== true) throw new HttpError(400, 'bad_field', 'moveToTrash can only be true.');
    out.moveToTrash = true;
  }
  if (Object.keys(out).length === 0) throw new HttpError(400, 'empty_patch', 'Nothing to change.');
  return out;
}

export async function patchMessage(db: Db, username: string, id: string, patch: PatchInput): Promise<MessageDto> {
  const update: Record<string, unknown> = {};
  if (patch.isRead !== undefined) update.is_read = patch.isRead;
  if (patch.isStarred !== undefined) update.is_starred = patch.isStarred;
  if (patch.moveToTrash) update.folder = 'trash';

  const rows = await db.update<MailRow>(
    'mail_messages',
    { id: `eq.${id}`, to_username: `eq.${username}`, select: DETAIL_COLUMNS },
    update
  );
  if (!rows[0]) throw new HttpError(404, 'not_found', 'Message not found.');
  return toDto(rows[0], false);
}

/** Permanent delete. Only allowed for items already in Trash (safety net). */
export async function deleteTrashed(db: Db, username: string, id: string): Promise<void> {
  const rows = await db.remove<{ id: string }>('mail_messages', {
    id: `eq.${id}`,
    to_username: `eq.${username}`,
    folder: 'eq.trash',
    select: 'id',
  });
  if (!rows[0]) throw new HttpError(404, 'not_found', 'Message not found in Trash.');
}

export interface DraftInput {
  id: string | null;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
}

export function parseDraft(body: unknown): DraftInput {
  if (!body || typeof body !== 'object') throw new HttpError(400, 'bad_body', 'Body must be an object.');
  const b = body as Record<string, unknown>;
  const id = b.id === undefined || b.id === null || b.id === '' ? null : parseId(String(b.id));
  const to = cleanRecipients(b.to, 'to');
  const cc = cleanRecipients(b.cc, 'cc');
  const bcc = cleanRecipients(b.bcc, 'bcc');
  checkRecipientCount(to, cc, bcc);
  return {
    id,
    to,
    cc,
    bcc,
    subject: cleanSubject(b.subject),
    body: cleanBody(b.body),
  };
}

export async function saveDraft(
  db: Db,
  username: string,
  senderEmail: string,
  senderName: string | null,
  draft: DraftInput
): Promise<MessageDto> {
  const row = {
    folder: 'drafts',
    to_username: username,
    from_email: senderEmail,
    from_name: senderName,
    to_email: draft.to.join(', ') || null,
    cc_emails: draft.cc,
    bcc_emails: draft.bcc,
    subject: draft.subject,
    snippet: makeSnippet(draft.body),
    body_text: draft.body,
    body_html: draft.body ? textToHtml(draft.body) : null,
    is_read: true,
    is_starred: false,
  };

  if (draft.id) {
    const rows = await db.update<MailRow>(
      'mail_messages',
      { id: `eq.${draft.id}`, to_username: `eq.${username}`, folder: 'eq.drafts', select: DETAIL_COLUMNS },
      row
    );
    if (!rows[0]) throw new HttpError(404, 'not_found', 'Draft not found.');
    return toDto(rows[0], true);
  }

  const inserted = await db.insert<MailRow>('mail_messages', row);
  return toDto(inserted, true);
}

export async function deleteDraft(db: Db, username: string, id: string): Promise<void> {
  await db.remove<{ id: string }>('mail_messages', {
    id: `eq.${id}`,
    to_username: `eq.${username}`,
    folder: 'eq.drafts',
    select: 'id',
  });
}

export function startOfUtcDayIso(now: Date = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

export async function countSentToday(db: Db, username: string, now?: Date): Promise<number> {
  return db.count('mail_messages', {
    to_username: `eq.${username}`,
    folder: 'eq.sent',
    received_at: `gte.${startOfUtcDayIso(now)}`,
  });
}
