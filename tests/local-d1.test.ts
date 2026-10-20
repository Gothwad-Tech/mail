// =============================================================================
// Real SQLite tests: the local D1 adapter, schema bootstrap, gzip compression
// and the retention rules. No mocks: node:sqlite runs the same SQL that
// Cloudflare D1 runs in production.
//
// Run with: npm run test:d1
// =============================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLocalD1 } from '../tools/local-d1.mjs';
import {
  compressBodies,
  ensureSchema,
  readBodies,
  SCHEMA_STATEMENTS,
  Db,
  type Db as DbType,
} from '../worker/src/db.ts';
import {
  DEFAULT_QUOTA_BYTES,
  DEFAULT_RETENTION_LIMIT,
  enforceRetention,
  getSettings,
  isRetentionLimit,
  mailboxStats,
  updateRetentionLimit,
} from '../worker/src/retention.ts';
import type { Env } from '../worker/src/config.ts';

function freshEnv(): { env: Env; db: ReturnType<typeof createLocalD1> } {
  const db = createLocalD1(':memory:');
  return { env: { DB: db } as unknown as Env, db };
}

/** Direct insert so bulk-retention tests stay fast (no gzip on every row). */
async function rawInsert(
  env: Env,
  opts: {
    id?: string;
    username?: string;
    folder?: 'inbox' | 'sent' | 'drafts' | 'trash';
    starred?: boolean;
    daysAgo?: number;
    sizeBytes?: number;
  } = {}
): Promise<string> {
  const db = await Db.from(env);
  const id = opts.id ?? crypto.randomUUID();
  const receivedAt = new Date(Date.now() - (opts.daysAgo ?? 0) * 24 * 60 * 60 * 1000).toISOString();
  await db.run(
    `INSERT INTO mail_messages
       (id, to_username, from_email, from_name, to_email, cc_emails, bcc_emails, subject, snippet,
        body_text, body_html, body_gzip, size_bytes, attachments, folder, is_read, is_starred, provider_id, received_at)
     VALUES (?, ?, 'a@b.com', 'A', 'x@y.com', '[]', '[]', 'Hi', 'Hi', 'Hi', NULL, NULL, ?, '[]', ?, 0, ?, NULL, ?)`,
    id,
    opts.username ?? 'alice',
    opts.sizeBytes ?? 100,
    opts.folder ?? 'inbox',
    opts.starred ? 1 : 0,
    receivedAt
  );
  return id;
}

async function count(env: Env, where = '1 = 1', ...params: string[]): Promise<number> {
  const db = await Db.from(env);
  const row = await db.first<{ n: number }>(
    `SELECT COUNT(*) AS n FROM mail_messages WHERE ${where}`,
    ...params
  );
  return Number(row?.n ?? 0);
}

// ---------------------------------------------------------------------------
// Adapter + schema
// ---------------------------------------------------------------------------

test('local D1 adapter behaves like D1: bind, first, all, run, batch, BLOB', async () => {
  const { db } = freshEnv();
  await db.batch([
    db.prepare('CREATE TABLE t (id TEXT PRIMARY KEY, name TEXT, blob BLOB)'),
    db.prepare("INSERT INTO t (id, name, blob) VALUES ('1', 'a', ?)").bind(new Uint8Array([1, 2, 3])),
  ]);
  const row = await db.prepare('SELECT * FROM t WHERE id = ?').bind('1').first();
  assert.equal(row.name, 'a');
  assert.deepEqual(Array.from(row.blob), [1, 2, 3]);

  const all = await db.prepare('SELECT * FROM t').all();
  assert.equal(all.results.length, 1);

  await assert.rejects(
    async () => db.batch([db.prepare("INSERT INTO t (id) VALUES ('2')"), db.prepare('INSERT INTO nope VALUES (1)')]),
    /no such table/,
    'a failing batch rolls back'
  );
  const after = await db.prepare('SELECT COUNT(*) AS n FROM t').first();
  assert.equal(after.n, 1);
});

test('schema bootstrap is idempotent and safe to run on every cold start', async () => {
  const { env } = freshEnv();
  await ensureSchema(env.DB!);
  await ensureSchema(env.DB!); // second isolate / second request
  const db = await Db.from(env);
  const tables = await db.all<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('mail_messages', 'mail_settings') ORDER BY name"
  );
  assert.deepEqual(
    tables.map((t) => t.name),
    ['mail_messages', 'mail_settings']
  );
  const indexes = await db.all<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_mail_%' ORDER BY name"
  );
  assert.deepEqual(
    indexes.map((i) => i.name),
    ['idx_mail_user_folder', 'idx_mail_user_starred']
  );
});

test('no schema statement contains PRAGMA (remote D1 rejects it with SQLITE_AUTH)', () => {
  for (const sql of SCHEMA_STATEMENTS) {
    assert.equal(/\bPRAGMA\b/i.test(sql), false, `PRAGMA found in: ${sql.slice(0, 40)}`);
  }
});

test('CHECK constraints protect folder and boolean columns', async () => {
  const { env } = freshEnv();
  const db = await Db.from(env);
  await assert.rejects(
    async () =>
      db.run(
        `INSERT INTO mail_messages (id, to_username, from_email, folder) VALUES ('x', 'alice', 'a@b.com', 'spam')`
      ),
    (err: { code?: string }) => err.code === 'db_unavailable',
    'the CHECK constraint rejects an unknown folder (D1 errors surface as db_unavailable)'
  );
});

// ---------------------------------------------------------------------------
// Gzip compression
// ---------------------------------------------------------------------------

test('gzip round-trip keeps Hindi, emojis and a large HTML newsletter intact', async () => {
  const text = 'नमस्ते पवन भाई! 🙏 ✅ Mail body gzip me store hoti hai.';
  const html = `<html><body><h1>समाचार 📰</h1>${'<p>Lorem ipsum dolor sit amet, consectetur adipiscing elit.</p>'.repeat(4000)}</body></html>`;
  assert.ok(html.length > 200_000, 'the fixture is a genuinely large newsletter');

  const blob = await compressBodies(text, html);
  assert.equal(blob[0], 0x1f);
  assert.equal(blob[1], 0x8b);
  assert.ok(blob.byteLength < html.length / 5, `HTML should compress well (${blob.byteLength} bytes)`);

  const back = await readBodies({ body_gzip: blob });
  assert.equal(back.text, text);
  assert.equal(back.html, html);
});

test('plain (pre-migration) rows still open through body_text/body_html', async () => {
  const bodies = await readBodies({ body_gzip: null, body_text: 'legacy text', body_html: '<p>legacy</p>' });
  assert.deepEqual(bodies, { text: 'legacy text', html: '<p>legacy</p>' });
});

test('a corrupt blob falls back instead of throwing', async () => {
  const bodies = await readBodies({ body_gzip: new Uint8Array([1, 2, 3, 4]), body_text: 'safe', body_html: null });
  assert.deepEqual(bodies, { text: 'safe', html: null });
});

// ---------------------------------------------------------------------------
// Settings + retention
// ---------------------------------------------------------------------------

test('settings default to 500 / 50 MB and are created on first read', async () => {
  const { env } = freshEnv();
  const db = await Db.from(env);
  const settings = await getSettings(db, 'alice');
  assert.equal(settings.retentionLimit, DEFAULT_RETENTION_LIMIT);
  assert.equal(settings.quotaBytes, DEFAULT_QUOTA_BYTES);
  assert.equal(isRetentionLimit(500), true);
  assert.equal(isRetentionLimit(1500), true);
  assert.equal(isRetentionLimit(0), true);
  assert.equal(isRetentionLimit(999), false);
  assert.equal(isRetentionLimit('500'), false);
});

test('stats sum size_bytes, count messages and count starred rows', async () => {
  const { env } = freshEnv();
  await rawInsert(env, { sizeBytes: 1000, starred: true });
  await rawInsert(env, { sizeBytes: 2000 });
  await rawInsert(env, { sizeBytes: 3000, username: 'bob' });
  const db = await Db.from(env);
  const stats = await mailboxStats(db, 'alice', DEFAULT_QUOTA_BYTES);
  assert.deepEqual(stats, {
    storageUsedBytes: 3000,
    storageQuotaBytes: DEFAULT_QUOTA_BYTES,
    totalMessages: 2,
    starredMessages: 1,
  });
});

test('count cap keeps the newest N unstarred inbox/sent messages', async () => {
  const { env } = freshEnv();
  for (let i = 0; i < 507; i += 1) {
    await rawInsert(env, { daysAgo: 507 - i, folder: i % 2 === 0 ? 'inbox' : 'sent' });
  }
  const db = await Db.from(env);
  const result = await enforceRetention(db, 'alice');
  assert.equal(result.trimmed, 7);
  assert.equal(await count(env, "to_username = 'alice'"), 500);
  const oldest = await db.first<{ received_at: string }>(
    "SELECT MIN(received_at) AS received_at FROM mail_messages WHERE to_username = 'alice'"
  );
  // The 7 oldest rows were 507..501 days ago; the new oldest is 500 days ago.
  const newestSurvivor = await db.first<{ n: number }>(
    "SELECT COUNT(*) AS n FROM mail_messages WHERE to_username = 'alice' AND received_at < ?",
    new Date(Date.now() - 502 * 24 * 60 * 60 * 1000).toISOString()
  );
  assert.equal(Number(newestSurvivor?.n ?? 0), 0, 'all trimmed rows are older than the kept ones');
  assert.ok(oldest?.received_at);
});

test('starred messages and drafts are immune to the count cap', async () => {
  const { env } = freshEnv();
  for (let i = 0; i < 505; i += 1) await rawInsert(env, { daysAgo: 1000 - i });
  for (let i = 0; i < 4; i += 1) await rawInsert(env, { daysAgo: 4000 + i, starred: true });
  for (let i = 0; i < 3; i += 1) await rawInsert(env, { daysAgo: 5000 + i, folder: 'drafts' });
  for (let i = 0; i < 2; i += 1) await rawInsert(env, { daysAgo: 10 + i, folder: 'trash' });

  const db = await Db.from(env);
  await enforceRetention(db, 'alice');

  assert.equal(await count(env, "to_username = 'alice' AND is_starred = 1"), 4, 'starred survive');
  assert.equal(await count(env, "to_username = 'alice' AND folder = 'drafts'"), 3, 'drafts survive');
  assert.equal(await count(env, "to_username = 'alice' AND folder = 'trash'"), 2, 'recent trash survives rule A');
  assert.equal(await count(env, "to_username = 'alice' AND folder IN ('inbox','sent') AND is_starred = 0"), 500);
});

test('trash older than 30 days is purged, newer trash and starred trash are kept', async () => {
  const { env } = freshEnv();
  const oldTrash = await rawInsert(env, { folder: 'trash', daysAgo: 31 });
  const starredOldTrash = await rawInsert(env, { folder: 'trash', daysAgo: 60, starred: true });
  const freshTrash = await rawInsert(env, { folder: 'trash', daysAgo: 29 });

  const db = await Db.from(env);
  const result = await enforceRetention(db, 'alice');
  assert.equal(result.trashPurged, 1);
  assert.equal(await count(env, 'id = ?', oldTrash), 0);
  assert.equal(await count(env, 'id = ?', starredOldTrash), 1);
  assert.equal(await count(env, 'id = ?', freshTrash), 1);
});

test('"Store All" keeps everything while under the quota', async () => {
  const { env } = freshEnv();
  const db = await Db.from(env);
  await updateRetentionLimit(db, 'alice', 0);
  for (let i = 0; i < 800; i += 1) await rawInsert(env, { daysAgo: 1000 - i });
  const result = await enforceRetention(db, 'alice');
  assert.equal(result.trimmed, 0);
  assert.equal(await count(env, "to_username = 'alice'"), 800);
});

test('"Store All" trims oldest trash first, then oldest mail, never starred', async () => {
  const { env } = freshEnv();
  const db = await Db.from(env);
  await updateRetentionLimit(db, 'alice', 0);
  await db.run("UPDATE mail_settings SET quota_bytes = 5000 WHERE username = 'alice'");

  const starred = await rawInsert(env, { daysAgo: 900, sizeBytes: 2000, starred: true });
  const oldTrash = await rawInsert(env, { daysAgo: 500, sizeBytes: 4000, folder: 'trash' });
  const oldInbox = await rawInsert(env, { daysAgo: 400, sizeBytes: 4000 });
  const newerInbox = await rawInsert(env, { daysAgo: 10, sizeBytes: 2000 });
  // Used = 12000 bytes, quota = 5000, so 7000+ bytes must go.

  const result = await enforceRetention(db, 'alice');
  // The old trash row is removed by Rule A before the quota even looks at it.
  assert.equal(result.trashPurged, 1);
  assert.equal(result.trimmed, 1, 'only the oldest inbox mail had to go');
  assert.equal(await count(env, 'id = ?', oldTrash), 0, 'trash goes first');
  assert.equal(await count(env, 'id = ?', oldInbox), 0, 'then the oldest inbox mail');
  assert.equal(await count(env, 'id = ?', newerInbox), 1, 'newest mail is kept');
  assert.equal(await count(env, 'id = ?', starred), 1, 'starred is never trimmed');

  const stats = await mailboxStats(db, 'alice', 5000);
  assert.ok(stats.storageUsedBytes <= 5000, 'mailbox is back under the quota');
});

test('retention is per-user: one user’s cleanup never touches another mailbox', async () => {
  const { env } = freshEnv();
  for (let i = 0; i < 5; i += 1) await rawInsert(env, { username: 'alice', daysAgo: 100 + i });
  for (let i = 0; i < 5; i += 1) await rawInsert(env, { username: 'bob', daysAgo: 100 + i });
  const db = await Db.from(env);
  await enforceRetention(db, 'alice');
  assert.equal(await count(env, "to_username = 'bob'"), 5);
});

// Keep TypeScript honest about the imported class type.
const _dbTypeCheck: DbType | null = null;
void _dbTypeCheck;
