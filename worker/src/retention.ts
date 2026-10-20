// =============================================================================
// Smart per-user retention for Cloudflare D1.
//
// WHY: the free D1 database is 500 MB shared by every mailbox. Without a cap,
// one spam-flooded account could fill it and break mail for everyone. Retention
// keeps the database small and predictable while never touching what users
// asked us to protect.
//
// The four rules (in the order they run):
//   A. Trash empties itself after 30 days.
//   B. Starred messages and drafts are NEVER auto-deleted (starred items can
//      only be removed by the owner, drafts are the user's un-sent work).
//   C. Count cap (retention_limit > 0, default 500): keep the newest N
//      unstarred inbox/sent messages, delete the older overflow.
//   D. Fair-use quota (retention_limit = 0, "Store All"): keep everything as
//      long as the mailbox stays under quota_bytes (default 50 MB compressed).
//      When over, delete the oldest unstarred trash first, then the oldest
//      unstarred mail.
// =============================================================================

import type { Db } from './db';

export const RETENTION_OPTIONS = [500, 1500, 0] as const;
export type RetentionLimit = (typeof RETENTION_OPTIONS)[number];

export const DEFAULT_RETENTION_LIMIT: RetentionLimit = 500;
/** 50 MB of compressed mail ≈ ~25,000 typical messages. */
export const DEFAULT_QUOTA_BYTES = 50 * 1024 * 1024;
export const TRASH_RETENTION_DAYS = 30;

export interface MailSettings {
  username: string;
  retentionLimit: number;
  quotaBytes: number;
  updatedAt: string;
}

export interface MailboxStats {
  storageUsedBytes: number;
  storageQuotaBytes: number;
  totalMessages: number;
  starredMessages: number;
}

export interface RetentionResult {
  trashPurged: number;
  trimmed: number;
}

export function isRetentionLimit(value: unknown): value is RetentionLimit {
  return typeof value === 'number' && (RETENTION_OPTIONS as readonly number[]).includes(value);
}

/** Reads settings, creating the default row the first time a mailbox is seen. */
export async function getSettings(db: Db, username: string): Promise<MailSettings> {
  await db.run(
    `INSERT INTO mail_settings (username, retention_limit, quota_bytes, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(username) DO NOTHING`,
    username,
    DEFAULT_RETENTION_LIMIT,
    DEFAULT_QUOTA_BYTES,
    new Date().toISOString()
  );
  const row = await db.first<{ username: string; retention_limit: number; quota_bytes: number; updated_at: string }>(
    'SELECT username, retention_limit, quota_bytes, updated_at FROM mail_settings WHERE username = ?',
    username
  );
  // The INSERT above guarantees a row; this fallback only guards a race.
  return {
    username,
    retentionLimit: Number(row?.retention_limit ?? DEFAULT_RETENTION_LIMIT),
    quotaBytes: Number(row?.quota_bytes ?? DEFAULT_QUOTA_BYTES),
    updatedAt: row?.updated_at ?? new Date().toISOString(),
  };
}

export async function updateRetentionLimit(db: Db, username: string, limit: RetentionLimit): Promise<MailSettings> {
  await db.run(
    `INSERT INTO mail_settings (username, retention_limit, quota_bytes, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(username) DO UPDATE SET retention_limit = excluded.retention_limit, updated_at = excluded.updated_at`,
    username,
    limit,
    DEFAULT_QUOTA_BYTES,
    new Date().toISOString()
  );
  return getSettings(db, username);
}

export async function usedBytes(db: Db, username: string): Promise<number> {
  const row = await db.first<{ used: number }>(
    'SELECT COALESCE(SUM(size_bytes), 0) AS used FROM mail_messages WHERE to_username = ?',
    username
  );
  return Number(row?.used ?? 0);
}

export async function mailboxStats(db: Db, username: string, quotaBytes: number): Promise<MailboxStats> {
  const row = await db.first<{ used: number; total: number; starred: number }>(
    `SELECT COALESCE(SUM(size_bytes), 0) AS used,
            COUNT(*) AS total,
            COALESCE(SUM(CASE WHEN is_starred = 1 THEN 1 ELSE 0 END), 0) AS starred
       FROM mail_messages
      WHERE to_username = ?`,
    username
  );
  return {
    storageUsedBytes: Number(row?.used ?? 0),
    storageQuotaBytes: quotaBytes,
    totalMessages: Number(row?.total ?? 0),
    starredMessages: Number(row?.starred ?? 0),
  };
}

/** Trims oldest unstarred mail until the mailbox fits inside quota_bytes. */
async function enforceQuota(db: Db, username: string, quotaBytes: number): Promise<number> {
  let removed = 0;
  // Bounded loop: each round frees at least the oldest rows and never spins.
  for (let round = 0; round < 25; round += 1) {
    const used = await usedBytes(db, username);
    const excess = used - quotaBytes;
    if (excess <= 0) break;

    // Trash goes first, then oldest mail. Drafts and starred rows are immune.
    const rows = await db.all<{ id: string; size_bytes: number }>(
      `SELECT id, size_bytes
         FROM mail_messages
        WHERE to_username = ? AND is_starred = 0 AND folder != 'drafts'
        ORDER BY (folder = 'trash') DESC, received_at ASC
        LIMIT 500`,
      username
    );
    if (rows.length === 0) break;

    const ids: string[] = [];
    let freed = 0;
    for (const row of rows) {
      ids.push(row.id);
      freed += Number(row.size_bytes ?? 0);
      // A little headroom so we do not need a second round for one big mail.
      if (freed >= excess) break;
    }
    const placeholders = ids.map(() => '?').join(',');
    removed += await db.runCount(
      `DELETE FROM mail_messages WHERE to_username = ? AND id IN (${placeholders})`,
      username,
      ...ids
    );
  }
  return removed;
}

/**
 * Runs every retention rule for one mailbox. Called after inbound mail, after a
 * send, and right after the user lowers their retention limit, so a mailbox is
 * never left oversized until some later background job.
 */
export async function enforceRetention(db: Db, username: string): Promise<RetentionResult> {
  const settings = await getSettings(db, username);

  // Rule A: 30-day trash purge.
  const cutoff = new Date(Date.now() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const trashPurged = await db.runCount(
    `DELETE FROM mail_messages
      WHERE to_username = ? AND folder = 'trash' AND is_starred = 0 AND received_at < ?`,
    username,
    cutoff
  );

  let trimmed = 0;

  if (settings.retentionLimit > 0) {
    // Rule C: count cap. Trash is handled by Rule A; drafts/starred are immune.
    trimmed = await db.runCount(
      `DELETE FROM mail_messages
        WHERE to_username = ?1
          AND is_starred = 0
          AND folder NOT IN ('drafts', 'trash')
          AND id NOT IN (
            SELECT id FROM mail_messages
             WHERE to_username = ?1
               AND is_starred = 0
               AND folder NOT IN ('drafts', 'trash')
             ORDER BY received_at DESC, id DESC
             LIMIT ?2
          )`,
      username,
      settings.retentionLimit
    );
  } else {
    // Rule D: "Store All" still respects the fair-use quota.
    trimmed = await enforceQuota(db, username, settings.quotaBytes);
  }

  return { trashPurged, trimmed };
}
