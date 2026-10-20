/**
 * =============================================================================
 * LOCAL CLOUDFLARE D1 ADAPTER (Node 22+ built-in `node:sqlite`)
 * =============================================================================
 * WHY THIS EXISTS:
 *   Production me Cloudflare `env.DB` (D1 = managed SQLite) deta hai. Local
 *   tests aur preview me bina kisi external package ya fake mock ke ASLI SQLite
 *   chalane ke liye yeh adapter Node 22 ke built-in `node:sqlite` module ko
 *   Cloudflare `D1Database` jaisa hi wrap karta hai:
 *
 *     db.prepare(sql).bind(...values).first()
 *     db.prepare(sql).bind(...values).all()   -> { success, results, meta }
 *     db.prepare(sql).bind(...values).run()   -> { success, results, meta }
 *     db.batch(statements)                    -> atomic transaction
 *     db.exec(sql)
 *
 *   Iska matlab: tests 100% asli SQL constraints (CHECK, UNIQUE, indexes, BLOB)
 *   par chalte hain. Jo SQL production D1 me chalega, wahi local me bhi chalta
 *   hai - isliye "mock pass hua par D1 fail hua" wali problem nahi hoti.
 * =============================================================================
 */

import { DatabaseSync } from 'node:sqlite';

function normalizeParam(value) {
  if (value === undefined) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value;
}

function normalizeRow(row) {
  if (!row) return null;
  // node:sqlite null-prototype objects deta hai; plain object me badla.
  const plain = { ...row };
  for (const [key, value] of Object.entries(plain)) {
    if (value instanceof Uint8Array && !Buffer.isBuffer(value)) {
      plain[key] = new Uint8Array(value);
    }
  }
  return plain;
}

class LocalD1PreparedStatement {
  #sqlite;
  #sql;
  #params;

  constructor(sqlite, sql, params = []) {
    this.#sqlite = sqlite;
    this.#sql = sql;
    this.#params = params;
  }

  bind(...values) {
    return new LocalD1PreparedStatement(this.#sqlite, this.#sql, values.map(normalizeParam));
  }

  /** D1 has no sync API, but batch() needs a sync path inside one transaction. */
  _executeSync() {
    const stmt = this.#sqlite.prepare(this.#sql);
    const trimmed = this.#sql.trim();
    const returnsRows =
      /^(SELECT|WITH|PRAGMA)\b/i.test(trimmed) || /\bRETURNING\b/i.test(trimmed);

    if (returnsRows) {
      const rows = stmt.all(...this.#params).map(normalizeRow);
      return {
        success: true,
        results: rows,
        meta: {
          changes: rows.length,
          last_row_id: 0,
          duration: 0,
          rows_read: rows.length,
          rows_written: /\b(INSERT|UPDATE|DELETE)\b/i.test(trimmed) ? rows.length : 0,
        },
      };
    }

    const info = stmt.run(...this.#params);
    return {
      success: true,
      results: [],
      meta: {
        changes: Number(info.changes || 0),
        last_row_id: Number(info.lastInsertRowid || 0),
        duration: 0,
        rows_read: 0,
        rows_written: Number(info.changes || 0),
      },
    };
  }

  async first(colName) {
    const out = this._executeSync();
    const row = out.results[0] ?? null;
    if (!row) return null;
    return colName !== undefined ? (row[colName] ?? null) : row;
  }

  async all() {
    return this._executeSync();
  }

  async run() {
    return this._executeSync();
  }

  async raw() {
    return this._executeSync().results.map((row) => Object.values(row));
  }
}

export class LocalD1Database {
  #sqlite;

  constructor(filename = ':memory:') {
    this.#sqlite = new DatabaseSync(filename);
    this.#sqlite.exec('PRAGMA foreign_keys = ON;');
    this.#sqlite.exec('PRAGMA busy_timeout = 5000;');
    if (filename !== ':memory:') this.#sqlite.exec('PRAGMA journal_mode = WAL;');
  }

  prepare(sql) {
    return new LocalD1PreparedStatement(this.#sqlite, sql);
  }

  async batch(statements) {
    this.#sqlite.exec('BEGIN IMMEDIATE;');
    try {
      const results = statements.map((stmt) => stmt._executeSync());
      this.#sqlite.exec('COMMIT;');
      return results;
    } catch (error) {
      try {
        this.#sqlite.exec('ROLLBACK;');
      } catch {
        // Rollback can fail if SQLite already aborted the transaction.
      }
      throw error;
    }
  }

  async exec(sql) {
    this.#sqlite.exec(sql);
    return { count: 1, duration: 0 };
  }

  close() {
    this.#sqlite.close();
  }
}

export function createLocalD1(filename = ':memory:') {
  return new LocalD1Database(filename);
}
