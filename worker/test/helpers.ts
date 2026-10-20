// =============================================================================
// Shared harness for the Worker tests.
//
// Every test file in this directory imports from here: a real in-memory SQLite
// (node:sqlite, via tools/local-d1.mjs), a replaceable upstream stub (Accounts,
// Resend) and small request builders. No database mock: the SQL that runs here
// is the SQL Cloudflare D1 runs in production.
//
// Run with: npm run test:worker
// =============================================================================


import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker, { handleRequest } from '../src/index.ts';
import { textToHtml, cleanRecipients, parsePatch } from '../src/mail.ts';

// Re-exported so a split test file can import everything it needs from here.
export { textToHtml, cleanRecipients, parsePatch };
import { localPartForDomain } from '../src/inbound.ts';
import { Db } from '../src/db.ts';
import { createLocalD1 } from '../../tools/local-d1.mjs';
import type { Env } from '../src/config.ts';

export const ORIGINAL_FETCH = globalThis.fetch;
export const MAIL_ORIGIN = 'https://mail.test';
export const ACCOUNTS_TOKEN = 'mail_internal_TEST_ONLY';
export const RESEND_KEY = 're_TEST_ONLY';

let seen: Seen[] = [];
let env: Env;
let d1: ReturnType<typeof createLocalD1>;

export interface Seen {
  url: URL;
  method: string;
  headers: Headers;
  body: string | null;
  signal: AbortSignal | null;
  redirect: RequestRedirect | null;
}

export type Stub = (s: Seen) => Response | Promise<Response>;
let stub: Stub = () => new Response('unexpected', { status: 599 });

export function installFetch() {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const s: Seen = {
      url,
      method: (init?.method || 'GET').toUpperCase(),
      headers: new Headers(init?.headers),
      body: typeof init?.body === 'string' ? init.body : null,
      signal: init?.signal ?? null,
      redirect: init?.redirect ?? null,
    };
    seen.push(s);
    return stub(s);
  }) as typeof fetch;
}

export function makeEnv(overrides: Partial<Env> = {}): Env {
  d1 = createLocalD1(':memory:');
  return {
    DB: d1 as unknown as Env['DB'],
    APP_DOMAIN: 'gothwadtech.com',
    AUTH_HUB_URL: 'https://accounts.test',
    MAIL_URL: MAIL_ORIGIN,
    ENVIRONMENT: 'production',
    ACCOUNTS_INTERNAL_TOKEN: ACCOUNTS_TOKEN,
    RESEND_API_KEY: RESEND_KEY,
    DAILY_SEND_LIMIT: '2',
    ...overrides,
  };
}

beforeEach(() => {
  seen = [];
  installFetch();
  env = makeEnv();
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  d1?.close?.();
});

export function req(path: string, init: RequestInit & { cookie?: string; origin?: string | null } = {}): Request {
  const headers = new Headers(init.headers);
  if (init.cookie) headers.set('cookie', init.cookie);
  if (init.origin !== undefined && init.origin !== null) headers.set('origin', init.origin);
  return new Request(`${MAIL_ORIGIN}${path}`, { ...init, headers });
}

export function authed(path: string, init: RequestInit = {}): Request {
  return req(path, { ...init, cookie: 'gothwad_at=good' });
}

export function writeInit(method: string, body: unknown): RequestInit {
  return {
    method,
    origin: MAIL_ORIGIN,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

/** Accounts stub that treats the cookie "gothwad_at=good" as user alice. */
export function accountsStub(s: Seen): Response | null {
  if (s.url.origin !== 'https://accounts.test') return null;
  if (s.url.pathname === '/api/auth/me') {
    if (s.headers.get('cookie') === 'gothwad_at=good') {
      return Response.json({
        authenticated: true,
        user: { username: 'Alice', first_name: 'Alice', last_name: 'Sharma' },
      });
    }
    return Response.json({ authenticated: false }, { status: 401 });
  }
  if (s.url.pathname === '/api/oauth/userinfo') {
    if (s.headers.get('authorization') === 'Bearer goodtoken') {
      return Response.json({ sub: '1', preferred_username: 'alice', name: 'Alice' });
    }
    return Response.json({ error: 'invalid_token' }, { status: 401 });
  }
  if (s.url.pathname.startsWith('/api/internal/usernames/')) {
    if (s.headers.get('authorization') !== `Bearer ${ACCOUNTS_TOKEN}`) {
      return Response.json({ error: 'unauthorized' }, { status: 401 });
    }
    const name = s.url.pathname.split('/').pop();
    return Response.json({ exists: name === 'pawan' || name === 'alice' });
  }
  return null;
}

/** Accounts + optional Resend stub. */
export function fullStub(s: Seen): Response {
  const accounts = accountsStub(s);
  if (accounts) return accounts;
  if (s.url.host === 'api.resend.com') return Response.json({ id: 're_msg_1' });
  return new Response('x', { status: 599 });
}

// ---------------------------------------------------------------------------
// Seeding helpers (real inserts, real gzip)
// ---------------------------------------------------------------------------

export async function seedMessage(opts: {
  username?: string;
  folder?: 'inbox' | 'sent' | 'drafts' | 'trash';
  subject?: string;
  text?: string;
  html?: string | null;
  starred?: boolean;
  read?: boolean;
  daysAgo?: number;
  sizeBytes?: number;
  from?: string;
} = {}): Promise<string> {
  const db = await Db.from(env);
  const id = crypto.randomUUID();
  const receivedAt = new Date(Date.now() - (opts.daysAgo ?? 0) * 24 * 60 * 60 * 1000).toISOString();
  await db.run(
    `INSERT INTO mail_messages
       (id, to_username, from_email, from_name, to_email, cc_emails, bcc_emails, subject, snippet,
        body_text, body_html, body_gzip, size_bytes, attachments, folder, is_read, is_starred, provider_id, received_at)
     VALUES (?, ?, ?, 'Sender', 'x@y.com', '[]', '[]', ?, ?, ?, ?, NULL, ?, '[]', ?, ?, ?, NULL, ?)`,
    id,
    opts.username ?? 'alice',
    opts.from ?? 'sender@example.org',
    opts.subject ?? 'Hello',
    opts.text ?? 'Hello there',
    opts.text ?? 'Hello there',
    opts.html ?? null,
    opts.sizeBytes ?? 500,
    opts.folder ?? 'inbox',
    opts.read ? 1 : 0,
    opts.starred ? 1 : 0,
    receivedAt
  );
  return id;
}

export async function countRows(where = '1 = 1', ...params: string[]): Promise<number> {
  const db = await Db.from(env);
  const row = await db.first<{ n: number }>(`SELECT COUNT(*) AS n FROM mail_messages WHERE ${where}`, ...params);
  return Number(row?.n ?? 0);
}

export function accountsMeStub(make: (s: Seen) => Response): Stub {
  return (s) => {
    if (s.url.host === 'accounts.test' && s.url.pathname === '/api/auth/me') return make(s);
    return new Response('x', { status: 599 });
  };
}

export async function sessionResponse(customEnv: Env = env): Promise<{ res: Response; body: Record<string, unknown> }> {
  const res = await handleRequest(req('/api/session', { cookie: 'gothwad_at=fresh' }), customEnv);
  return { res, body: (await res.json()) as Record<string, unknown> };
}

export const EML = [
  'From: Ravi <ravi@example.org>',
  'To: pawan@gothwadtech.com',
  'Subject: Invoice for October',
  'Message-ID: <abc123@example.org>',
  'MIME-Version: 1.0',
  'Content-Type: multipart/mixed; boundary="BOUND--"',
  '',
  '--BOUND--',
  'Content-Type: text/plain; charset=utf-8',
  '',
  'नमस्ते! Please find the invoice attached. 🙏',
  '--BOUND--',
  'Content-Type: text/html; charset=utf-8',
  '',
  '<html><body><p>नमस्ते! <b>Invoice</b> attached 🙏</p></body></html>',
  '--BOUND--',
  'Content-Type: application/pdf; name="invoice.pdf"',
  'Content-Disposition: attachment; filename="invoice.pdf"',
  'Content-Transfer-Encoding: base64',
  '',
  'JVBERi0xLjQKJcOkw7zDtsOfCjIgMCBvYmoKPDwvTGVuZ3RoIDM+PgpzdHJlYW0K',
  '--BOUND--',
  '',
].join('\r\n');

export function inboundMessage(to: string, rawSize = EML.length): { msg: ForwardableEmailMessage; rejected: () => string | null } {
  let rejected: string | null = null;
  const msg = {
    from: 'ravi@example.org',
    to,
    rawSize,
    raw: new Response(EML).body!,
    headers: new Headers({ 'message-id': '<abc123@example.org>' }),
    setReject: (reason: string) => {
      rejected = reason;
    },
  } as unknown as ForwardableEmailMessage;
  return { msg, rejected: () => rejected };
}

// ---------------------------------------------------------------------------
// Shared harness state
//
// `h` is the live state every test file shares with these helpers: the current
// env (a fresh in-memory SQLite per test), the request log, and the upstream
// stub for that test. Tests assign `h.stub = ...` and read `h.env` / `h.seen`.
// One harness, many files, so each test file stays small.
// ---------------------------------------------------------------------------
export const h = {
  get env(): Env {
    return env;
  },
  set env(next: Env) {
    env = next;
  },
  get seen(): Seen[] {
    return seen;
  },
  get stub(): Stub {
    return stub;
  },
  set stub(next: Stub) {
    stub = next;
  },
};
