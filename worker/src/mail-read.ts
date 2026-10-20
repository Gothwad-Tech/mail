// =============================================================================
// Mail reads: the folder list, one message, and the ETag used for 304s.
//
// Every query filters on `username` from the VERIFIED session, so one user can
// never see another user's rows.
// =============================================================================

import { type Db, type DbParam } from './db';
import { HttpError } from './http';
import { type Folder, type MailRow, type MessageDto, parseFolder, toDto, toDetailDto, LIST_COLUMNS, DETAIL_COLUMNS } from './mail-types';

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
