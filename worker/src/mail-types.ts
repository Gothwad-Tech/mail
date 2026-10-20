// =============================================================================
// Mail domain: types, limits, validation and row -> API mapping.
//
// Nothing here touches the database except `toDetailDto`, which needs the gzip
// reader. Queries live in mail-read.ts / mail-write.ts; mail.ts re-exports all
// three so callers keep using one module.
// =============================================================================

import { readBodies } from './db';
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

export const LIST_COLUMNS =
  'id,folder,from_email,from_name,to_email,cc_emails,bcc_emails,subject,snippet,attachments,is_read,is_starred,received_at';
// size_bytes is needed for the ETag (and for draft edits), so detail reads it too.
export const DETAIL_COLUMNS = `${LIST_COLUMNS},size_bytes,body_text,body_html,body_gzip`;

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
