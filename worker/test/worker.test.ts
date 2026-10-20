// =============================================================================
// Worker tests on REAL SQLite (node:sqlite, via tools/local-d1.mjs).
//
// No database mock: the SQL that runs here is the SQL Cloudflare D1 runs in
// production. Only upstream HTTP (Accounts, Resend) is stubbed, by replacing
// globalThis.fetch.
//
// Run with: npm run test:worker
// =============================================================================

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker, { handleRequest } from '../src/index.ts';
import { textToHtml, cleanRecipients, parsePatch } from '../src/mail.ts';
import { localPartForDomain } from '../src/inbound.ts';
import { Db } from '../src/db.ts';
import { createLocalD1 } from '../../tools/local-d1.mjs';
import type { Env } from '../src/config.ts';

const ORIGINAL_FETCH = globalThis.fetch;
const MAIL_ORIGIN = 'https://mail.test';
const ACCOUNTS_TOKEN = 'mail_internal_TEST_ONLY';
const RESEND_KEY = 're_TEST_ONLY';

let seen: Seen[] = [];
let env: Env;
let d1: ReturnType<typeof createLocalD1>;

interface Seen {
  url: URL;
  method: string;
  headers: Headers;
  body: string | null;
  signal: AbortSignal | null;
  redirect: RequestRedirect | null;
}

type Stub = (s: Seen) => Response | Promise<Response>;
let stub: Stub = () => new Response('unexpected', { status: 599 });

function installFetch() {
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

function makeEnv(overrides: Partial<Env> = {}): Env {
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

function req(path: string, init: RequestInit & { cookie?: string; origin?: string | null } = {}): Request {
  const headers = new Headers(init.headers);
  if (init.cookie) headers.set('cookie', init.cookie);
  if (init.origin !== undefined && init.origin !== null) headers.set('origin', init.origin);
  return new Request(`${MAIL_ORIGIN}${path}`, { ...init, headers });
}

function authed(path: string, init: RequestInit = {}): Request {
  return req(path, { ...init, cookie: 'gothwad_at=good' });
}

function writeInit(method: string, body: unknown): RequestInit {
  return {
    method,
    origin: MAIL_ORIGIN,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

/** Accounts stub that treats the cookie "gothwad_at=good" as user alice. */
function accountsStub(s: Seen): Response | null {
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
function fullStub(s: Seen): Response {
  const accounts = accountsStub(s);
  if (accounts) return accounts;
  if (s.url.host === 'api.resend.com') return Response.json({ id: 're_msg_1' });
  return new Response('x', { status: 599 });
}

// ---------------------------------------------------------------------------
// Seeding helpers (real inserts, real gzip)
// ---------------------------------------------------------------------------

async function seedMessage(opts: {
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

async function countRows(where = '1 = 1', ...params: string[]): Promise<number> {
  const db = await Db.from(env);
  const row = await db.first<{ n: number }>(`SELECT COUNT(*) AS n FROM mail_messages WHERE ${where}`, ...params);
  return Number(row?.n ?? 0);
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

test('health is public, reports D1 readiness, and calls no upstream', async () => {
  const res = await worker.fetch(req('/api/health'), env);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.engine, 'cloudflare-d1-native');
  assert.equal(body.service, 'gothwad-mail');
  assert.deepEqual(body.database, { bound: true, ready: true, tables: 2 });
  assert.deepEqual(body.configured, {
    d1Binding: true,
    accountsInternalToken: true,
    resendApiKey: true,
  });
  assert.equal(seen.length, 0, 'health must not call upstreams');
});

test('health with no D1 binding says bound:false and never leaks values', async () => {
  const res = await worker.fetch(req('/api/health'), { ENVIRONMENT: 'production' });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.database, { bound: false, ready: false, tables: 0 });
  assert.deepEqual(body.configured, { d1Binding: false, accountsInternalToken: false, resendApiKey: false });
  const text = JSON.stringify(body);
  assert.equal(text.toLowerCase().includes('supabase'), false, 'zero Supabase fields remain');
  assert.equal(text.includes('re_'), false, 'never prints a key');
});

test('health bootstraps a brand-new empty D1 database on the very first request', async () => {
  const res = await worker.fetch(req('/api/health'), env);
  const body = await res.json();
  assert.equal(body.database.ready, true);
  assert.equal(body.database.tables, 2);
});

// ---------------------------------------------------------------------------
// Session / Accounts handoff (these rules must never regress)
// ---------------------------------------------------------------------------

test('unauthenticated list returns 401 with the Accounts signin base URL', async () => {
  stub = fullStub;
  const res = await worker.fetch(req('/api/mail/messages'), env);
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.equal(body.error, 'unauthenticated');
  assert.equal(body.signinUrl, 'https://accounts.test/signin?choose=1');
});

function accountsMeStub(make: (s: Seen) => Response): Stub {
  return (s) => {
    if (s.url.host === 'accounts.test' && s.url.pathname === '/api/auth/me') return make(s);
    return new Response('x', { status: 599 });
  };
}

async function sessionResponse(customEnv: Env = env): Promise<{ res: Response; body: Record<string, unknown> }> {
  const res = await handleRequest(req('/api/session', { cookie: 'gothwad_at=fresh' }), customEnv);
  return { res, body: (await res.json()) as Record<string, unknown> };
}

test('Accounts 401 -> Mail 401 with signinUrl (real signed-out answer)', async () => {
  stub = accountsMeStub(() => Response.json({ error: 'invalid_token' }, { status: 401 }));
  const { res, body } = await sessionResponse();
  assert.equal(res.status, 401);
  assert.equal(body.error, 'unauthenticated');
  assert.equal(body.signinUrl, 'https://accounts.test/signin?choose=1');
});

test('Accounts 403 -> Mail 401 with signinUrl', async () => {
  stub = accountsMeStub(() => Response.json({ error: 'forbidden' }, { status: 403 }));
  const { res, body } = await sessionResponse();
  assert.equal(res.status, 401);
});

test('Accounts 302 -> Mail 503 accounts_unexpected_response (never followed)', async () => {
  stub = accountsMeStub(
    () => new Response(null, { status: 302, headers: { location: 'https://accounts.test/signin' } })
  );
  const { res, body } = await sessionResponse();
  assert.equal(res.status, 503);
  assert.equal(body.error, 'accounts_unexpected_response');
  assert.equal(body.signinUrl, undefined, 'a 503 must not carry a sign-in link');
  assert.equal(body.upstreamStatus, 302);
  assert.equal(seen.find((s) => s.url.host === 'accounts.test')?.redirect, 'manual');
});

test('Accounts 200 with an HTML body -> Mail 503 accounts_unexpected_response', async () => {
  stub = accountsMeStub(
    () =>
      new Response('<html><body>Not found</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      })
  );
  const { res, body } = await sessionResponse();
  assert.equal(res.status, 503);
  assert.equal(body.error, 'accounts_unexpected_response');
  assert.equal(body.upstreamStatus, 200);
  assert.equal(body.upstreamContentType, 'text/html; charset=utf-8');
});

test('the 503 upstream detail never carries the Accounts body or a cookie', async () => {
  stub = accountsMeStub(
    () =>
      new Response('<html><body>SECRET_BODY</body></html>', {
        status: 200,
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'set-cookie': 'gothwad_at=SECRET_COOKIE_VALUE; Domain=.gothwadtech.com',
        },
      })
  );
  const { res, body } = await sessionResponse();
  assert.equal(res.status, 503);
  const text = JSON.stringify(body);
  assert.equal(text.includes('SECRET_BODY'), false);
  assert.equal(text.includes('SECRET_COOKIE_VALUE'), false);
  assert.deepEqual(Object.keys(body).sort(), ['error', 'message', 'upstreamContentType', 'upstreamStatus']);
});

test('Accounts 200 without an authenticated field -> 503 accounts_unexpected_response', async () => {
  stub = accountsMeStub(() => Response.json({ user: { username: 'pawan' } }));
  const { res, body } = await sessionResponse();
  assert.equal(res.status, 503);
  assert.equal(body.error, 'accounts_unexpected_response');
});

test('Accounts authenticated without a usable username -> 503 accounts_user_invalid', async () => {
  stub = accountsMeStub(() => Response.json({ authenticated: true, user: { username: '' } }));
  const { res, body } = await sessionResponse();
  assert.equal(res.status, 503);
  assert.equal(body.error, 'accounts_user_invalid');
  assert.equal(body.signinUrl, undefined, 'the user IS signed in, so no sign-in link');
});

test('Accounts unreachable -> 503 auth_unavailable', async () => {
  stub = () => {
    throw new Error('connect ECONNREFUSED');
  };
  const { res, body } = await sessionResponse();
  assert.equal(res.status, 503);
  assert.equal(body.error, 'auth_unavailable');
});

test('Accounts outage gives 503, not a fake signed-out state', async () => {
  stub = () => new Response('boom', { status: 500 });
  const res = await worker.fetch(req('/api/session', { cookie: 'gothwad_at=good' }), env);
  assert.equal(res.status, 503);
});

test('failures log one warn line with status, content-type and code (no secrets)', async () => {
  const warns: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warns.push(args.map(String).join(' '));
  };
  try {
    stub = accountsMeStub(
      () => new Response('<html>SECRET_BODY</html>', { status: 200, headers: { 'content-type': 'text/html' } })
    );
    await handleRequest(req('/api/session', { cookie: 'gothwad_at=SECRET_COOKIE_VALUE' }), env);
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(warns.length, 1);
  assert.match(warns[0], /code=accounts_unexpected_response/);
  assert.match(warns[0], /status=200/);
  assert.equal(warns[0].includes('SECRET_COOKIE_VALUE'), false);
  assert.equal(warns[0].includes('SECRET_BODY'), false);
});

const splitEnv = (): Env =>
  makeEnv({ AUTH_HUB_URL: 'https://api.test', AUTH_SIGNIN_URL: 'https://accounts.test' });

function hubOnlyStub(make: (s: Seen) => Response): Stub {
  return (s) => {
    if (s.url.host === 'api.test') return make(s);
    if (s.url.host === 'accounts.test') {
      return new Response('<html>spa</html>', { status: 200, headers: { 'content-type': 'text/html' } });
    }
    return new Response('x', { status: 599 });
  };
}

test('signed-out 401 uses AUTH_SIGNIN_URL while the session check uses AUTH_HUB_URL', async () => {
  const custom = splitEnv();
  stub = hubOnlyStub((s) =>
    s.url.pathname === '/api/auth/me'
      ? Response.json({ authenticated: false }, { status: 401 })
      : new Response('x', { status: 599 })
  );
  const res = await handleRequest(req('/api/session', { cookie: 'gothwad_at=fresh' }), custom);
  assert.equal(res.status, 401);
  const body = (await res.json()) as { error: string; signinUrl: string };
  assert.equal(body.signinUrl, 'https://accounts.test/signin?choose=1');
  assert.deepEqual(
    seen.map((s) => s.url.origin),
    ['https://api.test'],
    'server-side calls use the Custom Domain only'
  );
});

test('accountUrl uses AUTH_SIGNIN_URL and /api/auth/me still uses AUTH_HUB_URL', async () => {
  const custom = splitEnv();
  stub = hubOnlyStub((s) =>
    s.url.pathname === '/api/auth/me'
      ? Response.json({ authenticated: true, user: { username: 'alice', first_name: 'Alice' } })
      : new Response('x', { status: 599 })
  );
  const res = await handleRequest(req('/api/session', { cookie: 'gothwad_at=good' }), custom);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { accountUrl: string };
  assert.equal(body.accountUrl, 'https://accounts.test/me');
  assert.equal(seen.find((s) => s.url.pathname === '/api/auth/me')?.url.origin, 'https://api.test');
  assert.equal(seen.some((s) => s.url.host === 'accounts.test'), false);
});

test('bearer token path uses userinfo on AUTH_HUB_URL and derives the email', async () => {
  const custom = splitEnv();
  stub = hubOnlyStub((s) =>
    s.url.pathname === '/api/oauth/userinfo'
      ? Response.json({ sub: '1', preferred_username: 'alice', name: 'Alice' })
      : new Response('x', { status: 599 })
  );
  const res = await worker.fetch(req('/api/session', { headers: { authorization: 'Bearer goodtoken' } }), custom);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.user.email, 'alice@gothwadtech.com');
  assert.equal(body.user.name, 'Alice');
  assert.equal(seen.find((s) => s.url.pathname === '/api/oauth/userinfo')?.url.origin, 'https://api.test');
});

test('session returns derived email and remaining sends counted from D1', async () => {
  stub = fullStub;
  await seedMessage({ folder: 'sent', daysAgo: 0 });
  const res = await worker.fetch(authed('/api/session'), env);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.user.username, 'alice');
  assert.equal(body.user.email, 'alice@gothwadtech.com');
  assert.equal(body.user.name, 'Alice Sharma');
  assert.equal(body.limits.sendRemainingToday, 1, 'limit 2, one sent today');
  assert.equal(body.accountUrl, 'https://accounts.test/me');
});

test('rotated Accounts cookies are forwarded; other cookies are dropped', async () => {
  stub = (s) => {
    if (s.url.host !== 'accounts.test') return new Response('x', { status: 599 });
    const h = new Headers({ 'content-type': 'application/json' });
    h.append('set-cookie', 'gothwad_at=NEW_AT; Domain=.gothwadtech.com; Path=/; HttpOnly');
    h.append('set-cookie', 'gothwad_rt=NEW_RT; Domain=.gothwadtech.com; Path=/; HttpOnly');
    h.append('set-cookie', 'evil=1; Path=/');
    return new Response(
      JSON.stringify({ authenticated: true, user: { username: 'alice', first_name: 'Alice', last_name: '' } }),
      { status: 200, headers: h }
    );
  };
  const res = await handleRequest(req('/api/session', { cookie: 'gothwad_at=old; gothwad_rt=old' }), env);
  assert.equal(res.status, 200);
  const cookies = res.headers.getSetCookie();
  assert.ok(cookies.some((c) => c.startsWith('gothwad_at=NEW_AT')));
  assert.ok(cookies.some((c) => c.startsWith('gothwad_rt=NEW_RT')));
  assert.equal(cookies.some((c) => c.startsWith('evil=')), false);
  assert.equal((await res.text()).includes('NEW_AT'), false, 'token values are not echoed');
});

test('dev bypass works only with ENVIRONMENT=development', async () => {
  stub = fullStub;
  const res = await worker.fetch(req('/api/session'), makeEnv({ ENVIRONMENT: 'development', DEV_AUTH_USERNAME: 'pawan' }));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).user.email, 'pawan@gothwadtech.com');

  const prod = await worker.fetch(req('/api/session'), makeEnv({ DEV_AUTH_USERNAME: 'pawan' }));
  assert.equal(prod.status, 401, 'the bypass is ignored in production');
});

// ---------------------------------------------------------------------------
// Mailbox listing / detail
// ---------------------------------------------------------------------------

test('list only returns the session user’s mail, newest first', async () => {
  stub = fullStub;
  await seedMessage({ subject: 'old', daysAgo: 3 });
  await seedMessage({ subject: 'new', daysAgo: 0 });
  await seedMessage({ subject: 'bob-mail', username: 'bob' });

  const res = await worker.fetch(authed('/api/mail/messages?folder=inbox'), env);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(
    body.messages.map((m: { subject: string }) => m.subject),
    ['new', 'old']
  );
  assert.equal(body.folder, 'inbox');
});

test('pagination uses before= and returns nextBefore', async () => {
  stub = fullStub;
  for (let i = 0; i < 60; i += 1) await seedMessage({ subject: `m${i}`, daysAgo: 100 - i });

  const first = await (await worker.fetch(authed('/api/mail/messages?folder=inbox&limit=50'), env)).json();
  assert.equal(first.messages.length, 50);
  assert.ok(first.nextBefore);

  const second = await (
    await worker.fetch(authed(`/api/mail/messages?folder=inbox&limit=50&before=${encodeURIComponent(first.nextBefore)}`), env)
  ).json();
  assert.equal(second.messages.length, 10);
  assert.equal(new Set([...first.messages, ...second.messages].map((m: { id: string }) => m.id)).size, 60);
});

test('starred view excludes trash and unstarred mail', async () => {
  stub = fullStub;
  await seedMessage({ subject: 'star-inbox', starred: true });
  await seedMessage({ subject: 'star-sent', starred: true, folder: 'sent' });
  await seedMessage({ subject: 'star-trash', starred: true, folder: 'trash' });
  await seedMessage({ subject: 'plain' });

  const body = await (await worker.fetch(authed('/api/mail/messages?folder=starred'), env)).json();
  assert.deepEqual(body.messages.map((m: { subject: string }) => m.subject).sort(), ['star-inbox', 'star-sent']);
});

test('detail decompresses Hindi/emoji bodies; the list never carries bodies', async () => {
  stub = fullStub;
  const text = 'नमस्ते 🙏 यह ईमेल gzip में सुरक्षित है ✅';
  const html = `<html><body><h1>समाचार 📰</h1>${'<p>नमस्ते दुनिया</p>'.repeat(2000)}</body></html>`;
  const id = await seedMessage({ subject: 'Unicode', text, html });

  const list = await (await worker.fetch(authed('/api/mail/messages?folder=inbox'), env)).json();
  assert.equal('bodyText' in list.messages[0], false, 'list stays light');
  assert.equal('bodyHtml' in list.messages[0], false);

  const detail = await (await worker.fetch(authed(`/api/mail/messages/${id}`), env)).json();
  assert.equal(detail.message.bodyText, text);
  assert.equal(detail.message.bodyHtml, html);
});

test('GET detail sends an ETag and answers 304 without decompressing on revalidation', async () => {
  stub = fullStub;
  const id = await seedMessage({ subject: 'Cached', text: 'hello', html: '<p>hello</p>' });

  const first = await worker.fetch(authed(`/api/mail/messages/${id}`), env);
  assert.equal(first.status, 200);
  const etag = first.headers.get('etag');
  assert.ok(etag, 'the detail response carries a validator');
  assert.doesNotMatch(etag!, /undefined|NaN/, 'the tag is built from real stored values');
  assert.match(first.headers.get('cache-control') || '', /private/);
  assert.equal((await first.json()).message.bodyText, 'hello');

  const second = await worker.fetch(
    authed(`/api/mail/messages/${id}`, { headers: { 'if-none-match': etag! } }),
    env
  );
  assert.equal(second.status, 304);
  assert.equal(await second.text(), '', 'a 304 has no body');

  // A write changes the row, so the old tag must stop matching.
  await worker.fetch(authed(`/api/mail/messages/${id}`, writeInit('PATCH', { isStarred: true })), env);
  const third = await worker.fetch(
    authed(`/api/mail/messages/${id}`, { headers: { 'if-none-match': etag! } }),
    env
  );
  assert.equal(third.status, 200, 'stale tag revalidates to a fresh body');
  assert.equal((await third.json()).message.isStarred, true);
});

test('a message from another mailbox is a 404', async () => {
  stub = fullStub;
  const bobId = await seedMessage({ username: 'bob' });
  const res = await worker.fetch(authed(`/api/mail/messages/${bobId}`), env);
  assert.equal(res.status, 404);
});

test('bad folder and bad id are rejected before the database is touched', async () => {
  stub = fullStub;
  const bad = await worker.fetch(authed('/api/mail/messages?folder=spam'), env);
  assert.equal(bad.status, 400);
  const badId = await worker.fetch(authed('/api/mail/messages/not-a-uuid'), env);
  assert.equal(badId.status, 400);
});

test('malformed percent-encoding in a message id is a 400, not a 500', async () => {
  stub = fullStub;
  const res = await handleRequest(req('/api/mail/messages/%E0%A4%A', { cookie: 'gothwad_at=good' }), env);
  assert.equal(res.status, 400);
  assert.equal(((await res.json()) as { error: string }).error, 'bad_request');
});

// ---------------------------------------------------------------------------
// PATCH / DELETE
// ---------------------------------------------------------------------------

test('PATCH is refused from an unknown origin (CSRF guard)', async () => {
  stub = fullStub;
  const id = await seedMessage();
  const res = await worker.fetch(
    req(`/api/mail/messages/${id}`, {
      method: 'PATCH',
      cookie: 'gothwad_at=good',
      origin: 'https://evil.example',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ isStarred: true }),
    }),
    env
  );
  assert.equal(res.status, 403);
  const row = await (await Db.from(env)).first<{ is_starred: number }>(
    'SELECT is_starred FROM mail_messages WHERE id = ?',
    id
  );
  assert.equal(row?.is_starred, 0, 'the write was refused');
});

test('PATCH needs JSON content-type even from our own origin', async () => {
  stub = fullStub;
  const id = await seedMessage();
  const res = await worker.fetch(
    req(`/api/mail/messages/${id}`, {
      method: 'PATCH',
      cookie: 'gothwad_at=good',
      origin: MAIL_ORIGIN,
      headers: { 'content-type': 'text/plain' },
      body: JSON.stringify({ isStarred: true }),
    }),
    env
  );
  assert.equal(res.status, 415);
});

test('PATCH updates only the session user’s row', async () => {
  stub = fullStub;
  const id = await seedMessage();
  const bobId = await seedMessage({ username: 'bob' });

  const res = await worker.fetch(authed(`/api/mail/messages/${id}`, writeInit('PATCH', { isStarred: true, isRead: true })), env);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.message.isStarred, true);
  assert.equal(body.message.isRead, true);

  const row = await (await Db.from(env)).first<{ is_starred: number; is_read: number }>(
    'SELECT is_starred, is_read FROM mail_messages WHERE id = ?',
    id
  );
  assert.deepEqual({ ...row }, { is_starred: 1, is_read: 1 });

  const other = await worker.fetch(authed(`/api/mail/messages/${bobId}`, writeInit('PATCH', { isStarred: true })), env);
  assert.equal(other.status, 404);
});

test('moveToTrash moves the row into the Trash folder', async () => {
  stub = fullStub;
  const id = await seedMessage();
  const res = await worker.fetch(authed(`/api/mail/messages/${id}`, writeInit('PATCH', { moveToTrash: true })), env);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).message.folder, 'trash');
});

test('DELETE is only allowed for items already in Trash', async () => {
  stub = fullStub;
  const inboxId = await seedMessage();
  const trashId = await seedMessage({ folder: 'trash' });

  const refused = await worker.fetch(authed(`/api/mail/messages/${inboxId}`, writeInit('DELETE', {})), env);
  assert.equal(refused.status, 404);
  assert.equal(await countRows('id = ?', inboxId), 1, 'inbox mail is not deleted');

  const ok = await worker.fetch(authed(`/api/mail/messages/${trashId}`, writeInit('DELETE', {})), env);
  assert.equal(ok.status, 200);
  assert.equal(await countRows('id = ?', trashId), 0);
});

test('PATCH rejects fields the client may not change', () => {
  assert.throws(() => parsePatch({ folder: 'inbox' }), /cannot be changed/);
  assert.throws(() => parsePatch({ to_username: 'bob' }), /cannot be changed/);
  assert.throws(() => parsePatch({ moveToTrash: false }), /moveToTrash/);
  assert.throws(() => parsePatch({}), /Nothing to change/);
});

// ---------------------------------------------------------------------------
// Drafts
// ---------------------------------------------------------------------------

test('drafts are created with a gzip body, updated in place, then deleted', async () => {
  stub = fullStub;
  const created = await worker.fetch(
    authed(
      '/api/mail/drafts',
      writeInit('POST', { to: ['bob@example.com'], cc: [], bcc: [], subject: 'Draft 1', body: 'नमस्ते 🙏' })
    ),
    env
  );
  assert.equal(created.status, 200);
  const draft = (await created.json()).message;
  assert.equal(draft.folder, 'drafts');
  assert.equal(draft.bodyText, 'नमस्ते 🙏');

  const updated = await worker.fetch(
    authed(
      '/api/mail/drafts',
      writeInit('POST', { id: draft.id, to: ['bob@example.com'], cc: [], bcc: [], subject: 'Draft 2', body: 'updated' })
    ),
    env
  );
  assert.equal(updated.status, 200);
  assert.equal((await updated.json()).message.id, draft.id, 'the same draft id is kept');
  assert.equal(await countRows("folder = 'drafts'"), 1, 'no duplicate draft was created');

  const removed = await worker.fetch(authed(`/api/mail/drafts/${draft.id}`, writeInit('DELETE', {})), env);
  assert.equal(removed.status, 200);
  assert.equal(await countRows("folder = 'drafts'"), 0);
});

// ---------------------------------------------------------------------------
// Send (Resend stub)
// ---------------------------------------------------------------------------

test('send without a Resend key returns a clear 503 and sends nothing', async () => {
  stub = fullStub;
  env = makeEnv({ RESEND_API_KEY: undefined });
  const res = await worker.fetch(
    authed('/api/mail/send', writeInit('POST', { to: ['bob@example.com'], subject: 'Hi', body: 'Hello' })),
    env
  );
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error, 'sending_not_configured');
  assert.equal(seen.filter((s) => s.url.host === 'api.resend.com').length, 0);
});

test('send uses username@APP_DOMAIN, saves a gzipped Sent copy and removes the draft', async () => {
  stub = fullStub;
  const draftId = await seedMessage({ folder: 'drafts' });

  const res = await worker.fetch(
    authed(
      '/api/mail/send',
      writeInit('POST', {
        to: ['Bob@Example.com'],
        cc: ['carol@example.com'],
        subject: 'Hi\r\nBcc: evil@x.com',
        body: 'Hello <b>there</b>',
        draftId,
      })
    ),
    env
  );
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.sent, true);
  assert.equal(body.saved, true);
  assert.equal(body.remainingToday, 1);

  const resend = seen.find((s) => s.url.host === 'api.resend.com');
  const payload = JSON.parse(resend?.body || '{}');
  assert.equal(payload.from, 'alice@gothwadtech.com');
  assert.deepEqual(payload.to, ['bob@example.com']);
  assert.deepEqual(payload.cc, ['carol@example.com']);
  assert.equal(payload.subject.includes('\n'), false, 'no header injection via subject');
  assert.equal(payload.html.includes('<b>'), false, 'user text is HTML-escaped');
  assert.equal(resend?.headers.get('authorization'), `Bearer ${RESEND_KEY}`);
  assert.equal(resend?.url.href.includes(RESEND_KEY), false, 'the key never goes in a URL');

  assert.equal(await countRows("folder = 'sent' AND is_read = 1"), 1, 'a Sent copy exists');
  assert.equal(await countRows('id = ?', draftId), 0, 'the draft is cleaned up');

  const detail = await (await worker.fetch(authed(`/api/mail/messages/${body.id}`), env)).json();
  assert.equal(detail.message.folder, 'sent');
  assert.equal(detail.message.bodyText, 'Hello <b>there</b>');
});

test('send stops at the daily limit with 429 and does not call Resend', async () => {
  stub = fullStub;
  env = makeEnv({ DAILY_SEND_LIMIT: '1' });
  await seedMessage({ folder: 'sent', daysAgo: 0 });

  const res = await worker.fetch(
    authed('/api/mail/send', writeInit('POST', { to: ['bob@example.com'], subject: 'Hi', body: 'Hello' })),
    env
  );
  assert.equal(res.status, 429);
  assert.equal((await res.json()).error, 'daily_limit');
  assert.equal(seen.filter((s) => s.url.host === 'api.resend.com').length, 0);
});

test('send validates recipients and refuses an empty recipient list', async () => {
  stub = fullStub;
  const empty = await worker.fetch(
    authed('/api/mail/send', writeInit('POST', { to: [], subject: 'Hi', body: 'x' })),
    env
  );
  assert.equal(empty.status, 400);
  assert.equal((await empty.json()).error, 'no_recipients');

  const bad = await worker.fetch(
    authed('/api/mail/send', writeInit('POST', { to: ['not-an-email'], subject: 'Hi', body: 'x' })),
    env
  );
  assert.equal(bad.status, 400);
  assert.equal(seen.filter((s) => s.url.host === 'api.resend.com').length, 0);
});

// ---------------------------------------------------------------------------
// Settings + retention over HTTP
// ---------------------------------------------------------------------------

test('GET settings returns defaults plus live storage stats', async () => {
  stub = fullStub;
  await seedMessage({ sizeBytes: 1200 });
  await seedMessage({ sizeBytes: 800, starred: true });

  const res = await worker.fetch(authed('/api/mail/settings'), env);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.retentionLimit, 500);
  assert.equal(body.storageQuotaBytes, 52_428_800);
  assert.equal(body.storageUsedBytes, 2000);
  assert.equal(body.totalMessages, 2);
  assert.equal(body.starredMessages, 1);
});

test('PATCH settings validates the limit and needs our origin', async () => {
  stub = fullStub;
  const invalid = await worker.fetch(authed('/api/mail/settings', writeInit('PATCH', { retentionLimit: 999 })), env);
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).error, 'bad_retention_limit');

  const noOrigin = await worker.fetch(
    req('/api/mail/settings', {
      method: 'PATCH',
      cookie: 'gothwad_at=good',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ retentionLimit: 1500 }),
    }),
    env
  );
  assert.equal(noOrigin.status, 403);
});

test('PATCH settings lowers the limit and trims immediately', async () => {
  stub = fullStub;
  const db = await Db.from(env);
  await db.run(
    "INSERT INTO mail_settings (username, retention_limit, quota_bytes, updated_at) VALUES ('alice', 0, 52428800, ?)",
    new Date().toISOString()
  );
  for (let i = 0; i < 505; i += 1) await seedMessage({ daysAgo: 600 - i, sizeBytes: 10 });
  await seedMessage({ daysAgo: 9999, starred: true, sizeBytes: 10 });

  const res = await worker.fetch(authed('/api/mail/settings', writeInit('PATCH', { retentionLimit: 500 })), env);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.retentionLimit, 500);
  assert.equal(body.cleanup.trimmed, 5);
  assert.equal(body.totalMessages, 501, '500 newest plus the starred one');
  assert.equal(body.starredMessages, 1);
});

test('PATCH settings to "Store All" (0) keeps everything under the quota', async () => {
  stub = fullStub;
  for (let i = 0; i < 5; i += 1) await seedMessage({ daysAgo: 10 + i, sizeBytes: 100 });
  const res = await worker.fetch(authed('/api/mail/settings', writeInit('PATCH', { retentionLimit: 0 })), env);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.retentionLimit, 0);
  assert.equal(body.totalMessages, 5);
});

// ---------------------------------------------------------------------------
// Inbound email
// ---------------------------------------------------------------------------

const EML = [
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

function inboundMessage(to: string, rawSize = EML.length): { msg: ForwardableEmailMessage; rejected: () => string | null } {
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

test('inbound email: parses MIME, stores Hindi body gzipped, drops attachment bytes', async () => {
  stub = fullStub;
  // The signed-in test user is alice, so mail to alice can also be opened via
  // the API below (the detail endpoint is scoped to the session user).
  await worker.email(inboundMessage('alice@gothwadtech.com').msg, env);

  const db = await Db.from(env);
  const row = await db.first<Record<string, unknown>>(
    "SELECT * FROM mail_messages WHERE to_username = 'alice' AND folder = 'inbox'"
  );
  assert.ok(row, 'row stored');
  assert.equal(row.from_email, 'ravi@example.org');
  assert.equal(row.subject, 'Invoice for October');
  assert.equal(row.provider_id, '<abc123@example.org>');
  assert.ok(row.body_gzip instanceof Uint8Array, 'the body is a gzip BLOB');
  assert.equal(row.body_text, null, 'plain columns stay empty for new rows');

  const attachments = JSON.parse(String(row.attachments)) as Array<{ name: string; type: string; size: number }>;
  assert.equal(attachments.length, 1);
  assert.equal(attachments[0].name, 'invoice.pdf');
  assert.ok(attachments[0].size > 0);
  assert.equal(JSON.stringify(row).includes('JVBERi0x'), false, 'attachment bytes are not stored');

  const detail = await (await worker.fetch(authed('/api/mail/messages/' + String(row.id)), env)).json();
  assert.match(detail.message.bodyText, /नमस्ते/);
  assert.match(detail.message.bodyText, /🙏/);
});

test('inbound username lookup uses AUTH_HUB_URL, not AUTH_SIGNIN_URL', async () => {
  const custom = makeEnv({ AUTH_HUB_URL: 'https://api.test', AUTH_SIGNIN_URL: 'https://accounts.test' });
  env = custom;
  stub = (s) => {
    if (s.url.origin === 'https://api.test' && s.url.pathname === '/api/internal/usernames/pawan') {
      return Response.json({ exists: true });
    }
    return new Response('x', { status: 599 });
  };
  const { msg, rejected } = inboundMessage('pawan@gothwadtech.com');
  await worker.email(msg, custom);
  assert.equal(rejected(), null);
  const lookup = seen.find((s) => s.url.pathname.startsWith('/api/internal/usernames/'));
  assert.equal(lookup?.url.origin, 'https://api.test');
  assert.equal(seen.some((s) => s.url.host === 'accounts.test'), false);
});

test('inbound sends the Accounts token only in the Authorization header', async () => {
  stub = fullStub;
  const { msg, rejected } = inboundMessage('Pawan@gothwadtech.com');
  await worker.email(msg, env);
  assert.equal(rejected(), null);
  const lookup = seen.find((s) => s.url.pathname === '/api/internal/usernames/pawan');
  assert.ok(lookup);
  assert.equal(lookup.headers.get('authorization'), `Bearer ${ACCOUNTS_TOKEN}`);
  assert.equal(lookup.url.search, '');
  assert.equal(lookup.url.href.includes(ACCOUNTS_TOKEN), false);
});

test('inbound email for another domain is rejected and not stored', async () => {
  stub = fullStub;
  const { msg, rejected } = inboundMessage('pawan@gmail.com');
  await worker.email(msg, env);
  assert.match(rejected() ?? '', /Unknown recipient/);
  assert.equal(seen.length, 0);
  assert.equal(await countRows(), 0);
});

test('inbound email over the size cap is rejected before parsing', async () => {
  stub = fullStub;
  const { msg, rejected } = inboundMessage('pawan@gothwadtech.com', 999_999_999);
  await worker.email(msg, env);
  assert.match(rejected() ?? '', /too large/);
  assert.equal(seen.length, 0);
});

test('inbound email to an unknown Accounts username gets 550 and is not stored', async () => {
  stub = fullStub;
  const { msg, rejected } = inboundMessage('nobody-here@gothwadtech.com');
  await worker.email(msg, env);
  assert.match(rejected() ?? '', /^550 .*Unknown recipient/);
  assert.equal(await countRows(), 0);
});

test('inbound Accounts 401 gets 451 and is not stored', async () => {
  stub = (s) =>
    s.url.pathname.startsWith('/api/internal/usernames/')
      ? Response.json({ error: 'unauthorized' }, { status: 401 })
      : new Response('x', { status: 599 });
  const { msg, rejected } = inboundMessage('pawan@gothwadtech.com');
  await worker.email(msg, env);
  assert.match(rejected() ?? '', /^451 4\.3\.0 Temporary failure/);
  assert.equal(await countRows(), 0);
});

test('inbound Accounts network failure / timeout / bad JSON gets 451', async () => {
  for (const make of [
    () => Promise.reject(new TypeError('network down')),
    () => Promise.reject(new DOMException('operation timed out', 'TimeoutError')),
    () => new Response('{not-json', { status: 200 }),
  ]) {
    env = makeEnv();
    stub = (s) =>
      s.url.pathname.startsWith('/api/internal/usernames/') ? (make() as Response) : new Response('x', { status: 599 });
    const { msg, rejected } = inboundMessage('pawan@gothwadtech.com');
    await worker.email(msg, env);
    assert.match(rejected() ?? '', /^451 4\.3\.0 Temporary failure/);
    assert.equal(await countRows(), 0);
  }
});

test('inbound missing Accounts token gets 451 without any request or insert', async () => {
  env = makeEnv({ ACCOUNTS_INTERNAL_TOKEN: undefined });
  stub = () => new Response('unexpected request', { status: 599 });
  const { msg, rejected } = inboundMessage('pawan@gothwadtech.com');
  await worker.email(msg, env);
  assert.match(rejected() ?? '', /^451 4\.3\.0 Temporary failure/);
  assert.equal(seen.length, 0);
  assert.equal(await countRows(), 0);
});

test('inbound name with a bad shape is rejected before any Accounts call', async () => {
  stub = fullStub;
  const { msg, rejected } = inboundMessage('-bad@gothwadtech.com');
  await worker.email(msg, env);
  assert.match(rejected() ?? '', /^550 /);
  assert.equal(seen.length, 0);
});

test('inbound mail triggers retention: the mailbox stays at the cap', async () => {
  stub = fullStub;
  for (let i = 0; i < 500; i += 1) await seedMessage({ username: 'pawan', daysAgo: 400 + i, sizeBytes: 10 });
  await worker.email(inboundMessage('pawan@gothwadtech.com').msg, env);
  assert.equal(await countRows("to_username = 'pawan'"), 500, 'newest 500 kept, oldest trimmed');
  const newest = await (await Db.from(env)).first<{ subject: string }>(
    "SELECT subject FROM mail_messages WHERE to_username = 'pawan' ORDER BY received_at DESC LIMIT 1"
  );
  assert.equal(newest?.subject, 'Invoice for October', 'the just-received mail is kept');
});

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

test('CORS: only allowlisted origins get Allow-Origin', async () => {
  stub = fullStub;
  const ok = await worker.fetch(req('/api/health', { origin: MAIL_ORIGIN }), env);
  assert.equal(ok.headers.get('access-control-allow-origin'), MAIL_ORIGIN);
  const bad = await worker.fetch(req('/api/health', { origin: 'https://evil.example' }), env);
  assert.equal(bad.headers.get('access-control-allow-origin'), null);
});

test('unknown API paths return JSON 404', async () => {
  const res = await worker.fetch(req('/api/nope'), env);
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, 'not_found');
});

test('textToHtml escapes markup and keeps line breaks', () => {
  assert.equal(textToHtml('a <b>\nc'), 'a &lt;b&gt;<br>c');
  assert.throws(() => cleanRecipients('x', 'to'), /must be a list/);
  assert.deepEqual(cleanRecipients(['A@B.com', 'a@b.com'], 'to'), ['a@b.com']);
});

test('inbound routing only accepts our APP_DOMAIN, case-insensitive', () => {
  assert.equal(localPartForDomain('Pawan@GothwadTech.com', 'gothwadtech.com'), 'pawan');
  assert.equal(localPartForDomain('pawan@gmail.com', 'gothwadtech.com'), null);
  assert.equal(localPartForDomain('no-at-sign', 'gothwadtech.com'), null);
});
