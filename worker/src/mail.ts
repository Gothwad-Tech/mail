// =============================================================================
// Mail domain logic: validation, row <-> API mapping, and scoped SQL.
//
// Rule for every function here: take `username` from the VERIFIED session and
// put it in the WHERE clause. A user can only ever see rows where to_username
// matches their own username. Sent mail is stored with to_username = sender, so
// the same rule covers Inbox, Sent, Drafts and Trash.
//
// Storage: Cloudflare D1 (SQLite). Bodies live gzip-compressed in `body_gzip`
// (see db.ts), with the plain `body_text` / `body_html` columns kept as a
// fallback for older rows. `size_bytes` is the real stored footprint, which is
// what the retention quota counts.
// =============================================================================

import { compressBodies, readBodies, storedSize, type Db, type DbParam } from './db';
import { HttpError } from './http';

export type Folder = 'inbox' | 'starred' | 'sent' | 'drafts' | 'trash';
export type StoredFolder = 'inbox' | 'sent' | 'drafts' | 'trash';
const FOLDERS: readonly Folder[] = ['inbox', 'starred', 'sent', 'drafts', 'trash'];

export interface AttachmentMeta {
  name: string;
  type: string;
  size: number;
}

/** Row shape as stored in D1 `mail_messages` (only the columns we read). */
export interface MailRow {
  id: string;
  to_username: string;
  folder: StoredFolder;
  from_email: string;
  from_name: string | null;
  to_email: string | null;
  // SQLite has no arrays: these are JSON strings like '["a@b.com"]'.
  cc_emails: string;
  bcc_emails: string;
  subject: string | null;
  snippet: string | null;
  body_text: string | null;
  body_html: string | null;
  body_gzip: Uint8Array | null;
  size_bytes: number;
  attachments: string;
  is_read: number;
  is_starred: number;
  received_at: string;
}

/** What the browser gets. Camel-case, no DB column names leak out. */
export interface MessageDto {
  id: string;
  folder: StoredFolder;
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

const LIST_COLUMNS =
  'id,folder,from_email,from_name,to_email,cc_emails,bcc_emails,subject,snippet,attachments,is_read,is_starred,received_at';
// size_bytes is needed for the ETag (and for draft edits), so detail reads it too.
const DETAIL_COLUMNS = `${LIST_COLUMNS},size_bytes,body_text,body_html,body_gzip`;

export const MAX_RECIPIENTS = 25;
export const MAX_SUBJECT_CHARS = 255;
export const MAX_BODY_CHARS = 100_000;
/** D1 rejects rows over 2 MB; 250k chars of HTML is far below that even before gzip. */
export const MAX_STORED_HTML_CHARS = 250_000;
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

function parseJsonArray<T>(raw: unknown): T[] {
  if (typeof raw !== 'string' || raw === '') return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

/** List-view DTO: no bodies, so listing 50 mails never decompresses anything. */
export function toDto(row: MailRow): MessageDto {
  return {
    id: row.id,
    folder: row.folder,
    from: { name: row.from_name, email: row.from_email },
    to: splitList(row.to_email),
    cc: parseJsonArray<string>(row.cc_emails),
    bcc: parseJsonArray<string>(row.bcc_emails),
    subject: row.subject ?? '',
    snippet: row.snippet ?? '',
    receivedAt: row.received_at,
    isRead: Boolean(row.is_read),
    isStarred: Boolean(row.is_starred),
    attachments: parseJsonArray<AttachmentMeta>(row.attachments),
  };
}

/** Detail DTO: decompresses the gzip body (or falls back to legacy columns). */
export async function toDetailDto(row: MailRow): Promise<MessageDto> {
  const bodies = await readBodies(row);
  return { ...toDto(row), bodyText: bodies.text, bodyHtml: bodies.html };
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
  const params: DbParam[] = [username];
  let sql = `SELECT ${LIST_COLUMNS} FROM mail_messages WHERE to_username = ?`;
  if (opts.folder === 'starred') {
    // Starred view is the "important" mix, not Trash.
    sql += ` AND is_starred = 1 AND folder IN ('inbox', 'sent')`;
  } else {
    sql += ' AND folder = ?';
    params.push(opts.folder);
  }
  if (opts.before) {
    sql += ' AND received_at < ?';
    params.push(new Date(opts.before).toISOString());
  }
  sql += ' ORDER BY received_at DESC LIMIT ?';
  params.push(opts.limit);

  const rows = await db.all<MailRow>(sql, ...params);
  return rows.map(toDto);
}

/** The raw row, without decompressing the body. */
export async function getMessageRow(db: Db, username: string, id: string): Promise<MailRow> {
  const row = await db.first<MailRow>(
    `SELECT ${DETAIL_COLUMNS} FROM mail_messages WHERE id = ? AND to_username = ? LIMIT 1`,
    id,
    username
  );
  if (!row) throw new HttpError(404, 'not_found', 'Message not found.');
  return row;
}

/**
 * Validator for conditional requests. WHY: opening an already-seen mail should
 * not cost Cloudflare a gzip decompression. The tag is built from cheap columns
 * (never the body), so a client that sends If-None-Match can get a 304 and the
 * Worker stops before decompressing anything.
 */
export function messageEtag(row: MailRow): string {
  return `"m-${row.id}-${row.is_read}-${row.is_starred}-${row.size_bytes}-${row.received_at}"`;
}

export function etagMatches(ifNoneMatch: string | null, etag: string): boolean {
  if (!ifNoneMatch) return false;
  return ifNoneMatch
    .split(',')
    .map((part) => part.trim().replace(/^W\//, ''))
    .some((part) => part === '*' || part === etag);
}

export async function getMessage(db: Db, username: string, id: string): Promise<MessageDto> {
  return toDetailDto(await getMessageRow(db, username, id));
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
  const sets: string[] = [];
  const params: DbParam[] = [];
  if (patch.isRead !== undefined) {
    sets.push('is_read = ?');
    params.push(patch.isRead ? 1 : 0);
  }
  if (patch.isStarred !== undefined) {
    sets.push('is_starred = ?');
    params.push(patch.isStarred ? 1 : 0);
  }
  if (patch.moveToTrash) sets.push("folder = 'trash'");

  const row = await db.first<MailRow>(
    `UPDATE mail_messages SET ${sets.join(', ')} WHERE id = ? AND to_username = ? RETURNING ${DETAIL_COLUMNS}`,
    ...params,
    id,
    username
  );
  if (!row) throw new HttpError(404, 'not_found', 'Message not found.');
  return toDto(row);
}

/** Permanent delete. Only allowed for items already in Trash (safety net). */
export async function deleteTrashed(db: Db, username: string, id: string): Promise<void> {
  const changes = await db.runCount(
    "DELETE FROM mail_messages WHERE id = ? AND to_username = ? AND folder = 'trash'",
    id,
    username
  );
  if (changes === 0) throw new HttpError(404, 'not_found', 'Message not found in Trash.');
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

interface StoredPayload {
  bodyGzip: Uint8Array;
  sizeBytes: number;
  snippet: string;
}

/** Caps bodies, gzips them, and measures the real footprint in one place. */
async function buildPayload(text: string, html: string | null, sizeMeta: unknown): Promise<StoredPayload> {
  const safeText = text.length > MAX_BODY_CHARS ? text.slice(0, MAX_BODY_CHARS) : text;
  const safeHtml = html === null ? null : html.length > MAX_STORED_HTML_CHARS ? html.slice(0, MAX_STORED_HTML_CHARS) : html;
  const bodyGzip = await compressBodies(safeText, safeHtml);
  return {
    bodyGzip,
    sizeBytes: storedSize(bodyGzip, sizeMeta),
    snippet: makeSnippet(safeText),
  };
}

export async function saveDraft(
  db: Db,
  username: string,
  senderEmail: string,
  senderName: string | null,
  draft: DraftInput
): Promise<MessageDto> {
  const toEmail = draft.to.join(', ') || null;
  const html = draft.body ? textToHtml(draft.body) : null;
  const payload = await buildPayload(draft.body, html, {
    from: senderEmail,
    name: senderName,
    to: draft.to,
    cc: draft.cc,
    bcc: draft.bcc,
    subject: draft.subject,
  });

  if (draft.id) {
    const row = await db.first<MailRow>(
      `UPDATE mail_messages
          SET to_email = ?, cc_emails = ?, bcc_emails = ?, subject = ?, snippet = ?,
              body_text = NULL, body_html = NULL, body_gzip = ?, size_bytes = ?
        WHERE id = ? AND to_username = ? AND folder = 'drafts'
        RETURNING ${DETAIL_COLUMNS}`,
      toEmail,
      JSON.stringify(draft.cc),
      JSON.stringify(draft.bcc),
      draft.subject,
      payload.snippet,
      payload.bodyGzip,
      payload.sizeBytes,
      draft.id,
      username
    );
    if (!row) throw new HttpError(404, 'not_found', 'Draft not found.');
    return toDetailDto(row);
  }

  const id = crypto.randomUUID();
  const row = await db.first<MailRow>(
    `INSERT INTO mail_messages
       (id, to_username, folder, from_email, from_name, to_email, cc_emails, bcc_emails,
        subject, snippet, body_text, body_html, body_gzip, size_bytes, attachments,
        is_read, is_starred, provider_id)
     VALUES (?, ?, 'drafts', ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, '[]', 1, 0, NULL)
     RETURNING ${DETAIL_COLUMNS}`,
    id,
    username,
    senderEmail,
    senderName,
    toEmail,
    JSON.stringify(draft.cc),
    JSON.stringify(draft.bcc),
    draft.subject,
    payload.snippet,
    payload.bodyGzip,
    payload.sizeBytes
  );
  if (!row) throw new HttpError(503, 'db_error', 'Draft could not be saved.');
  return toDetailDto(row);
}

export async function deleteDraft(db: Db, username: string, id: string): Promise<void> {
  await db.runCount("DELETE FROM mail_messages WHERE id = ? AND to_username = ? AND folder = 'drafts'", id, username);
}

export interface NewMessageInput {
  id?: string;
  username: string;
  folder: StoredFolder;
  fromEmail: string;
  fromName: string | null;
  to: string[];
  toEmail?: string | null;
  cc?: string[];
  bcc?: string[];
  subject: string;
  text: string;
  html: string | null;
  attachments?: AttachmentMeta[];
  isRead: boolean;
  isStarred?: boolean;
  providerId: string | null;
  receivedAt?: string;
}

/**
 * Inserts one message and returns the stored DTO. Used by inbound SMTP and by
 * the "save a copy in Sent" path, so both share the gzip + size_bytes logic.
 */
export async function insertMessage(db: Db, input: NewMessageInput): Promise<MessageDto> {
  const cc = input.cc ?? [];
  const bcc = input.bcc ?? [];
  const attachments = input.attachments ?? [];
  const toEmail = input.toEmail ?? (input.to.join(', ') || null);

  const payload = await buildPayload(input.text, input.html, {
    from: input.fromEmail,
    name: input.fromName,
    to: input.to,
    cc,
    bcc,
    subject: input.subject,
    attachments,
  });

  const id = input.id ?? crypto.randomUUID();
  const receivedAt = input.receivedAt ?? new Date().toISOString();
  const row = await db.first<MailRow>(
    `INSERT INTO mail_messages
       (id, to_username, from_email, from_name, to_email, cc_emails, bcc_emails,
        subject, snippet, body_text, body_html, body_gzip, size_bytes, attachments,
        folder, is_read, is_starred, provider_id, received_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?)
     RETURNING ${DETAIL_COLUMNS}`,
    id,
    input.username,
    input.fromEmail,
    input.fromName,
    toEmail,
    JSON.stringify(cc),
    JSON.stringify(bcc),
    input.subject,
    payload.snippet,
    payload.bodyGzip,
    payload.sizeBytes,
    JSON.stringify(attachments),
    input.folder,
    input.isRead ? 1 : 0,
    input.isStarred ? 1 : 0,
    input.providerId,
    receivedAt
  );
  if (!row) throw new HttpError(503, 'db_error', 'Message could not be saved.');
  return toDetailDto(row);
}

export function startOfUtcDayIso(now: Date = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

export async function countSentToday(db: Db, username: string, now?: Date): Promise<number> {
  const row = await db.first<{ n: number }>(
    "SELECT COUNT(*) AS n FROM mail_messages WHERE to_username = ? AND folder = 'sent' AND received_at >= ?",
    username,
    startOfUtcDayIso(now)
  );
  return Number(row?.n ?? 0);
}
