// =============================================================================
// Supabase (PostgREST) client used ONLY from the Worker.
//
// Auth headers (important, from Supabase's rules):
//   - New keys look like `sb_secret_...`. They are NOT JWTs. Send them in the
//     `apikey` header ONLY. Putting them in `Authorization: Bearer` makes
//     Supabase reply "Invalid API key".
//   - Legacy service_role keys look like `eyJ...` (a JWT). Those can go in
//     both `apikey` and `Authorization`.
//
// Security: the service key bypasses RLS. So EVERY query in this file is
// scoped by to_username taken from the verified session. Callers must pass it.
// =============================================================================

import type { Config, Env } from './config';
import { isSupabaseConfigured } from './config';
import { HttpError } from './http';

export class Db {
  private readonly baseUrl: string;

  constructor(
    private readonly key: string,
    config: Config
  ) {
    this.baseUrl = `${config.supabaseUrl}/rest/v1`;
  }

  static from(env: Env, config: Config): Db {
    if (!isSupabaseConfigured(config)) {
      throw new HttpError(503, 'not_configured', 'Supabase URL is not set for this Worker.');
    }
    const key = env.SUPABASE_SERVICE_ROLE_KEY;
    if (!key) {
      throw new HttpError(503, 'not_configured', 'Supabase service key is not set for this Worker.');
    }
    return new Db(key, config);
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const h: Record<string, string> = {
      apikey: this.key,
      'content-type': 'application/json',
      ...extra,
    };
    // Legacy JWT keys also go in Authorization. sb_secret_ keys must NOT.
    if (this.key.startsWith('eyJ')) {
      h.authorization = `Bearer ${this.key}`;
    }
    return h;
  }

  private async send(
    method: string,
    table: string,
    query: Record<string, string>,
    opts: { body?: unknown; prefer?: string[] } = {}
  ): Promise<Response> {
    const qs = new URLSearchParams(query).toString();
    const url = `${this.baseUrl}/${table}${qs ? `?${qs}` : ''}`;
    const headers = this.headers(opts.prefer ? { prefer: opts.prefer.join(',') } : {});
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        signal: AbortSignal.timeout(8000),
      });
    } catch {
      throw new HttpError(502, 'db_unavailable', 'Database is not reachable right now.');
    }
    if (!res.ok) {
      // Log status only. The body may echo row data, so do not log it.
      console.error('supabase_error', method, table, res.status);
      throw new HttpError(502, 'db_error', 'Database request failed.');
    }
    return res;
  }

  async select<T>(table: string, query: Record<string, string>): Promise<T[]> {
    const res = await this.send('GET', table, query);
    return (await res.json()) as T[];
  }

  /** Returns the exact row count using PostgREST's Content-Range header. */
  async count(table: string, query: Record<string, string>): Promise<number> {
    const qs = new URLSearchParams({ ...query, select: 'id' }).toString();
    const url = `${this.baseUrl}/${table}?${qs}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'HEAD',
        headers: this.headers({ prefer: 'count=exact' }),
        signal: AbortSignal.timeout(8000),
      });
    } catch {
      throw new HttpError(502, 'db_unavailable', 'Database is not reachable right now.');
    }
    if (!res.ok) throw new HttpError(502, 'db_error', 'Database request failed.');
    const range = res.headers.get('content-range') || '';
    const total = Number(range.split('/')[1]);
    return Number.isFinite(total) ? total : 0;
  }

  async insert<T>(table: string, row: Record<string, unknown>): Promise<T> {
    const res = await this.send('POST', table, {}, {
      body: row,
      prefer: ['return=representation'],
    });
    const rows = (await res.json()) as T[];
    if (!rows[0]) throw new HttpError(502, 'db_error', 'Insert returned no row.');
    return rows[0];
  }

  async update<T>(table: string, query: Record<string, string>, patch: Record<string, unknown>): Promise<T[]> {
    const res = await this.send('PATCH', table, query, {
      body: patch,
      prefer: ['return=representation'],
    });
    return (await res.json()) as T[];
  }

  async remove<T>(table: string, query: Record<string, string>): Promise<T[]> {
    const res = await this.send('DELETE', table, query, { prefer: ['return=representation'] });
    return (await res.json()) as T[];
  }
}
