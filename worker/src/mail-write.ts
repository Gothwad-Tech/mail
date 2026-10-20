// =============================================================================
// Mail writes: patch, delete, drafts, sending a copy, and the daily send count.
//
// Same rule as the reads: `username` comes from the verified session and is
// part of every WHERE clause.
// =============================================================================

import { type Db, type DbParam, compressBodies, storedSize } from './db';
import { HttpError } from './http';
import { type StoredFolder, type AttachmentMeta, type MailRow, type MessageDto, MAX_BODY_CHARS, MAX_STORED_HTML_CHARS, parseId, cleanRecipients, cleanSubject, cleanBody, checkRecipientCount, textToHtml, makeSnippet, toDto, toDetailDto, DETAIL_COLUMNS } from './mail-types';

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
