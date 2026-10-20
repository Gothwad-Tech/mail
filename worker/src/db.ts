// =============================================================================
// Cloudflare D1 access for Gothwad Mail. Zero Supabase, zero PostgREST.
//
// WHY THIS FILE LOOKS LIKE THIS
//   Cloudflare D1 is SQLite. A Worker gets it as `env.DB` (wrangler.toml
//   `[[d1_databases]] binding = "DB"`). Instead of an HTTP database, we now run
//   plain SQL through prepared statements - faster, cheaper and no extra secret.
//
// AUTO-BOOTSTRAP (why): a brand-new D1 database is empty. If the schema had to
//   be pasted into the dashboard before the first request, the very first
//   `GET /api/health` would 500 and every deploy would need a manual step. So on
//   the first request for a given D1 instance we run idempotent
//   `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` in one batch.
//   A `WeakMap<object, Promise<void>>` remembers that promise per D1 object, so
//   many concurrent requests share ONE bootstrap and it never re-runs on a warm
//   isolate either.
//
// NO PRAGMA: remote D1 already enforces `foreign_keys = ON` and rejects PRAGMA
//   with SQLITE_AUTH. The schema below therefore contains none.
//
// COMPRESSION (why): D1's free tier stores 500 MB. HTML mail compresses ~5-8x,
//   so gzip keeps roughly 250k messages inside that free tier. Bodies are stored
//   as ONE gzip BLOB holding JSON `{ t: text, h: html }`. The old plain
//   `body_text` / `body_html` columns are kept for compatibility: a row written
//   before compression existed is still readable.
//
// ROW LIMIT GUARD: D1 rejects rows above 2 MB, so raw text/html are capped
//   BEFORE compression (see mail.ts: 100k text chars, 250k html chars).
// =============================================================================

import type { Env } from './config';
import { HttpError } from './http';

// ---------------------------------------------------------------------------
// Schema (keep sql/01_mail_schema.sql in step with this list)
// ---------------------------------------------------------------------------

export const SCHEMA_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS mail_settings (
    username        TEXT PRIMARY KEY,
    retention_limit INTEGER NOT NULL DEFAULT 500,
    quota_bytes     INTEGER NOT NULL DEFAULT 52428800,
    updated_at      TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS mail_messages (
    id            TEXT PRIMARY KEY,
    to_username   TEXT NOT NULL,
    from_email    TEXT NOT NULL,
    from_name     TEXT,
    to_email      TEXT,
    cc_emails     TEXT NOT NULL DEFAULT '[]',
    bcc_emails    TEXT NOT NULL DEFAULT '[]',
    subject       TEXT,
    snippet       TEXT,
    body_text     TEXT,
    body_html     TEXT,
    body_gzip     BLOB,
    size_bytes    INTEGER NOT NULL DEFAULT 0,
    attachments   TEXT NOT NULL DEFAULT '[]',
    folder        TEXT NOT NULL DEFAULT 'inbox' CHECK (folder IN ('inbox', 'sent', 'drafts', 'trash')),
    is_read       INTEGER NOT NULL DEFAULT 0 CHECK (is_read IN (0, 1)),
    is_starred    INTEGER NOT NULL DEFAULT 0 CHECK (is_starred IN (0, 1)),
    provider_id   TEXT,
    received_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_mail_user_folder
     ON mail_messages (to_username, folder, received_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_mail_user_starred
     ON mail_messages (to_username, is_starred, received_at DESC) WHERE is_starred = 1`,
];

const initializedDbs = new WeakMap<object, Promise<void>>();

/** Runs the idempotent schema once per D1 instance (cold-start safe). */
export async function ensureSchema(d1: D1Database): Promise<void> {
  const key = d1 as unknown as object;
  let pending = initializedDbs.get(key);
  if (!pending) {
    const created: Promise<void> = d1
      .batch(SCHEMA_STATEMENTS.map((sql) => d1.prepare(sql)))
      .then(() => undefined)
      .catch((err: unknown) => {
        // Do not remember a failure: the next request retries (a transient D1
        // error must not brick a warm isolate until it is recycled).
        initializedDbs.delete(key);
        console.error('d1_bootstrap_failed', err instanceof Error ? err.message : String(err));
        throw new HttpError(503, 'db_unavailable', 'Mailbox database is not ready. Please try again.');
      });
    initializedDbs.set(key, created);
    pending = created;
  }
  await pending;
}

// ---------------------------------------------------------------------------
// Thin D1 wrapper
// ---------------------------------------------------------------------------

export type DbParam = string | number | null | Uint8Array;

export class Db {
  private constructor(private readonly d1: D1Database) {}

  /** Opens (and on first use bootstraps) the D1 database bound as `DB`. */
  static async from(env: Env): Promise<Db> {
    if (!env.DB) {
      throw new HttpError(503, 'db_not_configured', 'Cloudflare D1 binding "DB" is missing for this Worker.');
    }
    await ensureSchema(env.DB);
    return new Db(env.DB);
  }

  async all<T>(sql: string, ...params: DbParam[]): Promise<T[]> {
    try {
      const res = await this.d1.prepare(sql).bind(...params).all<T>();
      return (res.results ?? []) as T[];
    } catch (err) {
      throw this.fail(sql, err);
    }
  }

  async first<T>(sql: string, ...params: DbParam[]): Promise<T | null> {
    const rows = await this.all<T>(sql, ...params);
    return rows[0] ?? null;
  }

  async run(sql: string, ...params: DbParam[]): Promise<void> {
    try {
      await this.d1.prepare(sql).bind(...params).run();
    } catch (err) {
      throw this.fail(sql, err);
    }
  }

  /** Returns how many rows a DELETE/UPDATE affected. */
  async runCount(sql: string, ...params: DbParam[]): Promise<number> {
    try {
      const res = await this.d1.prepare(sql).bind(...params).run();
      return Number(res.meta?.changes ?? 0);
    } catch (err) {
      throw this.fail(sql, err);
    }
  }

  private fail(sql: string, err: unknown): HttpError {
    // Statement text only - never bound values (they can hold mail content).
    console.error('d1_error', sql.split(/\s+/).slice(0, 3).join(' '), err instanceof Error ? err.message : String(err));
    return new HttpError(503, 'db_unavailable', 'Mailbox database is not reachable right now.');
  }
}

// ---------------------------------------------------------------------------
// Gzip helpers (Web Streams; available in Workers and Node 18+)
// ---------------------------------------------------------------------------

async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Response(bytes).body!.pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Response(bytes).body!.pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export interface StoredBodies {
  text: string;
  html: string | null;
}

/** Compresses `{ text, html }` into the single `body_gzip` BLOB. */
export async function compressBodies(text: string, html: string | null): Promise<Uint8Array> {
  return gzip(new TextEncoder().encode(JSON.stringify({ t: text, h: html })));
}

/**
 * Reads a message body. Prefers `body_gzip`; falls back to the legacy plain
 * columns so rows written before the D1 migration still open.
 */
export async function readBodies(row: {
  body_gzip?: Uint8Array | ArrayBuffer | null;
  body_text?: string | null;
  body_html?: string | null;
}): Promise<StoredBodies> {
  const blob = row.body_gzip;
  if (blob) {
    const bytes = blob instanceof Uint8Array ? blob : new Uint8Array(blob);
    // A gzip file starts with 1f 8b. Anything else is stored JSON/text.
    if (bytes.byteLength >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
      try {
        const plain = new TextDecoder().decode(await gunzip(bytes));
        const parsed = JSON.parse(plain) as { t?: unknown; h?: unknown };
        return {
          text: typeof parsed.t === 'string' ? parsed.t : '',
          html: typeof parsed.h === 'string' ? parsed.h : null,
        };
      } catch {
        // Corrupt blob: fall through to the legacy columns rather than 500.
        console.error('body_decompress_failed');
      }
    } else {
      try {
        const parsed = JSON.parse(new TextDecoder().decode(bytes)) as { t?: unknown; h?: unknown };
        return {
          text: typeof parsed.t === 'string' ? parsed.t : '',
          html: typeof parsed.h === 'string' ? parsed.h : null,
        };
      } catch {
        console.error('body_decode_failed');
      }
    }
  }
  return { text: row.body_text ?? '', html: row.body_html ?? null };
}

/** Bytes a row really occupies, used for the per-user fair-use quota. */
export function storedSize(compressed: Uint8Array, meta: unknown): number {
  return compressed.byteLength + new TextEncoder().encode(JSON.stringify(meta)).byteLength;
}
