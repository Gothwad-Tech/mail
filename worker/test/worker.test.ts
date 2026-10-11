// =============================================================================
// Worker tests. No network: Accounts, Supabase and Resend are stubbed by
// replacing globalThis.fetch. Run with: npm run test:worker
// =============================================================================

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.ts';
import { handleRequest } from '../src/index.ts';
import { textToHtml, cleanRecipients, parsePatch } from '../src/mail.ts';
import { localPartForDomain } from '../src/inbound.ts';
import type { Env } from '../src/config.ts';

const ORIGINAL_FETCH = globalThis.fetch;
const MAIL_ORIGIN = 'https://mail.test';
const SB_KEY = 'sb_secret_TEST_ONLY';
const LEGACY_JWT = 'eyJhbGciOiJIUzI1NiJ9.TEST.ONLY';
const ACCOUNTS_TOKEN = 'mail_internal_TEST_ONLY';

const baseEnv: Env = {
  APP_DOMAIN: 'gothwadtech.com',
  AUTH_HUB_URL: 'https://accounts.test',
  MAIL_URL: MAIL_ORIGIN,
  SUPABASE_URL: 'https://abcdefgh.supabase.co',
  ENVIRONMENT: 'production',
  ACCOUNTS_INTERNAL_TOKEN: ACCOUNTS_TOKEN,
  SUPABASE_SERVICE_ROLE_KEY: SB_KEY,
  RESEND_API_KEY: 're_TEST_ONLY',
  DAILY_SEND_LIMIT: '2',
};

interface Seen {
  url: URL;
  method: string;
  headers: Headers;
  body: string | null;
  signal: AbortSignal | null;
  redirect: RequestRedirect | null;
}

let seen: Seen[] = [];
type Stub = (s: Seen) => Response | Promise<Response>;
let stub: Stub = () => new Response('unexpected', { status: 599 });

function installFetch() {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const headers = new Headers(init?.headers);
    const s: Seen = {
      url,
      method: (init?.method || 'GET').toUpperCase(),
      headers,
      body: typeof init?.body === 'string' ? init.body : null,
      signal: init?.signal ?? null,
      redirect: init?.redirect ?? null,
    };
    seen.push(s);
    return stub(s);
  }) as typeof fetch;
}

beforeEach(() => {
  seen = [];
  installFetch();
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

function req(path: string, init: RequestInit & { cookie?: string; origin?: string | null } = {}): Request {
  const headers = new Headers(init.headers);
  if (init.cookie) headers.set('cookie', init.cookie);
  if (init.origin !== undefined && init.origin !== null) headers.set('origin', init.origin);
  return new Request(`${MAIL_ORIGIN}${path}`, { ...init, headers });
}

/** Accounts stub that treats the cookie "session=good" as user "alice". */
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
  return null;
}

test('health is public and does not need Supabase', async () => {
  const res = await worker.fetch(req('/api/health'), baseEnv);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(seen.length, 0, 'health must not call upstreams');
});

test('unauthenticated list returns 401 with the Accounts signin base URL', async () => {
  stub = (s) => accountsStub(s) ?? new Response('x', { status: 599 });
  const res = await worker.fetch(req('/api/mail/messages'), baseEnv);
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.equal(body.error, 'unauthenticated');
  assert.equal(body.signinUrl, 'https://accounts.test/signin?choose=1');
});

// -----------------------------------------------------------------------------
// /api/session status table. A 401 may ONLY mean "Accounts says signed out";
// every other broken handoff must be a 503 with its own code, otherwise the
// browser bounces back to the Accounts chooser in a loop.
// -----------------------------------------------------------------------------

/** Accounts stub that answers /api/auth/me with exactly what `make` returns. */
function accountsMeStub(make: (s: Seen) => Response): Stub {
  return (s) => {
    if (s.url.host === 'accounts.test' && s.url.pathname === '/api/auth/me') return make(s);
    return new Response('x', { status: 599 }); // Supabase is not needed by these tests
  };
}

async function sessionResponse(env: Env = baseEnv): Promise<{ res: Response; body: Record<string, unknown> }> {
  const res = await handleRequest(req('/api/session', { cookie: 'gothwad_at=fresh' }), env);
  const body = (await res.json()) as Record<string, unknown>;
  return { res, body };
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
  assert.equal(body.error, 'unauthenticated');
  assert.equal(body.signinUrl, 'https://accounts.test/signin?choose=1');
});

test('Accounts 302 -> Mail 503 accounts_unexpected_response (never followed)', async () => {
  stub = accountsMeStub(
    () => new Response(null, { status: 302, headers: { location: 'https://accounts.test/signin' } })
  );
  const { res, body } = await sessionResponse();
  assert.equal(res.status, 503);
  assert.equal(body.error, 'accounts_unexpected_response');
  assert.equal(body.signinUrl, undefined, 'a 503 must not carry a sign-in link');
  const accountsCall = seen.find((s) => s.url.host === 'accounts.test');
  assert.equal(accountsCall?.redirect, 'manual', 'the upstream redirect must not be followed');
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
});

test('Accounts 200 without an authenticated field -> Mail 503 accounts_unexpected_response', async () => {
  stub = accountsMeStub(() => Response.json({ user: { username: 'pawan' } }));
  const { res, body } = await sessionResponse();
  assert.equal(res.status, 503);
  assert.equal(body.error, 'accounts_unexpected_response');
});

test('Accounts 200 authenticated with username "Pawan" -> Mail 200 username pawan', async () => {
  stub = accountsMeStub(() =>
    Response.json({ authenticated: true, user: { username: 'Pawan', first_name: 'Pawan', last_name: '' } })
  );
  const { res, body } = await sessionResponse();
  assert.equal(res.status, 200);
  const user = body.user as { username: string; email: string; name: string | null };
  assert.equal(user.username, 'pawan');
  assert.equal(user.email, 'pawan@gothwadtech.com');
  assert.equal(user.name, 'Pawan');
});

test('Accounts 200 authenticated without a usable username -> Mail 503 accounts_user_invalid', async () => {
  stub = accountsMeStub(() => Response.json({ authenticated: true, user: { username: '' } }));
  const { res, body } = await sessionResponse();
  assert.equal(res.status, 503);
  assert.equal(body.error, 'accounts_user_invalid');
  assert.equal(body.signinUrl, undefined, 'the user IS signed in, so no sign-in link');
});

test('Accounts 200 authenticated with a missing user object -> Mail 503 accounts_user_invalid', async () => {
  stub = accountsMeStub(() => Response.json({ authenticated: true }));
  const { res, body } = await sessionResponse();
  assert.equal(res.status, 503);
  assert.equal(body.error, 'accounts_user_invalid');
});

test('Accounts unreachable (fetch throws) -> Mail 503 auth_unavailable', async () => {
  stub = () => {
    throw new Error('connect ECONNREFUSED');
  };
  const { res, body } = await sessionResponse();
  assert.equal(res.status, 503);
  assert.equal(body.error, 'auth_unavailable');
});

test('failures log one warn line with status, content-type and code (no cookie, no body)', async () => {
  const warns: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warns.push(args.map(String).join(' '));
  };
  try {
    stub = accountsMeStub(
      () =>
        new Response('<html>SECRET_BODY</html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        })
    );
    const res = await handleRequest(req('/api/session', { cookie: 'gothwad_at=SECRET_COOKIE_VALUE' }), baseEnv);
    assert.equal(res.status, 503);
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(warns.length, 1, 'exactly one warn line per failure');
  assert.match(warns[0], /code=accounts_unexpected_response/);
  assert.match(warns[0], /status=200/);
  assert.match(warns[0], /content-type=text\/html/);
  assert.equal(warns[0].includes('SECRET_COOKIE_VALUE'), false, 'never log the cookie');
  assert.equal(warns[0].includes('SECRET_BODY'), false, 'never log the response body');
});

test('a network failure logs the code with no upstream status', async () => {
  const warns: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warns.push(args.map(String).join(' '));
  };
  try {
    stub = () => {
      throw new Error('connect ECONNREFUSED');
    };
    await handleRequest(req('/api/session', { cookie: 'gothwad_at=fresh' }), baseEnv);
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(warns.length, 1);
  assert.match(warns[0], /code=auth_unavailable status=none content-type=none/);
});

test('session returns derived email and remaining sends for a cookie session', async () => {
  stub = (s) =>
    accountsStub(s) ??
    (s.url.host === 'abcdefgh.supabase.co'
      ? new Response(null, { status: 200, headers: { 'content-range': '*/1' } })
      : new Response('x', { status: 599 }));
  const res = await worker.fetch(req('/api/session', { cookie: 'gothwad_at=good' }), baseEnv);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.user.username, 'alice');
  assert.equal(body.user.email, 'alice@gothwadtech.com');
  assert.equal(body.user.name, 'Alice Sharma');
  assert.equal(body.limits.sendRemainingToday, 1);
  assert.equal(body.accountUrl, 'https://accounts.test/me');
});

test('Accounts outage gives 503, not a fake signed-out state', async () => {
  stub = () => new Response('boom', { status: 500 });
  const res = await worker.fetch(req('/api/session', { cookie: 'gothwad_at=good' }), baseEnv);
  assert.equal(res.status, 503);
});

test('bearer token path uses userinfo and derives the email', async () => {
  stub = (s) =>
    accountsStub(s) ??
    new Response(null, { status: 200, headers: { 'content-range': '*/0' } });
  const res = await worker.fetch(req('/api/session', { headers: { authorization: 'Bearer goodtoken' } }), baseEnv);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.user.email, 'alice@gothwadtech.com');
  assert.equal(body.user.name, 'Alice');
});

test('Supabase is called only with the service key, scoped to the session user', async () => {
  stub = (s) => {
    const a = accountsStub(s);
    if (a) return a;
    return Response.json([]);
  };
  const res = await worker.fetch(
    req('/api/mail/messages?folder=inbox', { cookie: 'gothwad_at=good' }),
    baseEnv
  );
  assert.equal(res.status, 200);
  const sb = seen.find((s) => s.url.host === 'abcdefgh.supabase.co');
  assert.ok(sb, 'supabase was called');
  assert.equal(sb.url.searchParams.get('to_username'), 'eq.alice');
  assert.equal(sb.url.searchParams.get('folder'), 'eq.inbox');
  // sb_secret_ keys go in apikey only (Supabase rejects them as Bearer).
  assert.equal(sb.headers.get('apikey'), SB_KEY);
  assert.equal(sb.headers.get('authorization'), null);
});

test('legacy eyJ service key is also sent as Bearer', async () => {
  stub = (s) => accountsStub(s) ?? Response.json([]);
  const env = { ...baseEnv, SUPABASE_SERVICE_ROLE_KEY: LEGACY_JWT };
  await worker.fetch(req('/api/mail/messages', { cookie: 'gothwad_at=good' }), env);
  const sb = seen.find((s) => s.url.host === 'abcdefgh.supabase.co');
  assert.equal(sb?.headers.get('authorization'), `Bearer ${LEGACY_JWT}`);
});

test('starred view uses folder in (inbox,sent) and excludes trash', async () => {
  stub = (s) => accountsStub(s) ?? Response.json([]);
  await worker.fetch(req('/api/mail/messages?folder=starred', { cookie: 'gothwad_at=good' }), baseEnv);
  const sb = seen.find((s) => s.url.host === 'abcdefgh.supabase.co');
  assert.equal(sb?.url.searchParams.get('folder'), 'in.(inbox,sent)');
  assert.equal(sb?.url.searchParams.get('is_starred'), 'eq.true');
});

test('bad folder and bad id are rejected before any DB call', async () => {
  stub = (s) => accountsStub(s) ?? Response.json([]);
  const bad = await worker.fetch(req('/api/mail/messages?folder=spam', { cookie: 'gothwad_at=good' }), baseEnv);
  assert.equal(bad.status, 400);
  const badId = await worker.fetch(req('/api/mail/messages/not-a-uuid', { cookie: 'gothwad_at=good' }), baseEnv);
  assert.equal(badId.status, 400);
  assert.equal(seen.filter((s) => s.url.host === 'abcdefgh.supabase.co').length, 0);
});

test('PATCH is refused from an unknown origin (CSRF guard)', async () => {
  stub = (s) => accountsStub(s) ?? Response.json([]);
  const res = await worker.fetch(
    req('/api/mail/messages/11111111-2222-3333-4444-555555555555', {
      method: 'PATCH',
      cookie: 'gothwad_at=good',
      origin: 'https://evil.example',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ isStarred: true }),
    }),
    baseEnv
  );
  assert.equal(res.status, 403);
});

test('PATCH needs JSON content-type even from our own origin', async () => {
  stub = (s) => accountsStub(s) ?? Response.json([]);
  const res = await worker.fetch(
    req('/api/mail/messages/11111111-2222-3333-4444-555555555555', {
      method: 'PATCH',
      cookie: 'gothwad_at=good',
      origin: MAIL_ORIGIN,
      headers: { 'content-type': 'text/plain' },
      body: JSON.stringify({ isStarred: true }),
    }),
    baseEnv
  );
  assert.equal(res.status, 415);
});

test('PATCH from our origin updates only the scoped row', async () => {
  stub = (s) => {
    const a = accountsStub(s);
    if (a) return a;
    return Response.json([
      {
        id: '11111111-2222-3333-4444-555555555555',
        folder: 'inbox',
        from_email: 'a@b.com',
        from_name: null,
        to_email: 'alice@gothwadtech.com',
        cc_emails: [],
        bcc_emails: [],
        subject: 'Hi',
        snippet: '',
        attachments: [],
        is_read: true,
        is_starred: true,
        received_at: '2026-10-10T00:00:00Z',
      },
    ]);
  };
  const res = await worker.fetch(
    req('/api/mail/messages/11111111-2222-3333-4444-555555555555', {
      method: 'PATCH',
      cookie: 'gothwad_at=good',
      origin: MAIL_ORIGIN,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ isStarred: true, isRead: true }),
    }),
    baseEnv
  );
  assert.equal(res.status, 200);
  const sb = seen.find((s) => s.method === 'PATCH');
  assert.equal(sb?.url.searchParams.get('to_username'), 'eq.alice');
  assert.deepEqual(JSON.parse(sb?.body || '{}'), { is_starred: true, is_read: true });
});

test('PATCH rejects fields the client may not change (e.g. folder, to_username)', async () => {
  assert.throws(() => parsePatch({ folder: 'inbox' }), /cannot be changed/);
  assert.throws(() => parsePatch({ to_username: 'bob' }), /cannot be changed/);
  assert.throws(() => parsePatch({ moveToTrash: false }), /moveToTrash/);
  assert.throws(() => parsePatch({}), /Nothing to change/);
});

test('send without a Resend key returns a clear 503 and sends nothing', async () => {
  stub = (s) => accountsStub(s) ?? Response.json([]);
  const env = { ...baseEnv, RESEND_API_KEY: undefined };
  const res = await worker.fetch(
    req('/api/mail/send', {
      method: 'POST',
      cookie: 'gothwad_at=good',
      origin: MAIL_ORIGIN,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ to: ['bob@example.com'], subject: 'Hi', body: 'Hello' }),
    }),
    env
  );
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error, 'sending_not_configured');
  assert.equal(seen.filter((s) => s.url.host === 'api.resend.com').length, 0);
});

test('send: Resend gets from=username@APP_DOMAIN, sent copy saved, draft cleaned up', async () => {
  const draftId = '99999999-2222-3333-4444-555555555555';
  stub = (s) => {
    const a = accountsStub(s);
    if (a) return a;
    if (s.url.host === 'api.resend.com') return Response.json({ id: 're_msg_1' });
    if (s.url.host === 'abcdefgh.supabase.co') {
      if (s.method === 'HEAD') return new Response(null, { status: 200, headers: { 'content-range': '*/0' } });
      if (s.method === 'POST') return Response.json([{ id: 'row-1' }]);
      if (s.method === 'DELETE') return Response.json([]);
    }
    return new Response('x', { status: 599 });
  };
  const res = await worker.fetch(
    req('/api/mail/send', {
      method: 'POST',
      cookie: 'gothwad_at=good',
      origin: MAIL_ORIGIN,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        to: ['Bob@Example.com'],
        cc: ['carol@example.com'],
        subject: 'Hi\r\nBcc: evil@x.com',
        body: 'Hello <b>there</b>',
        draftId,
      }),
    }),
    baseEnv
  );
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.saved, true);
  assert.equal(body.remainingToday, 1); // limit 2, none sent before, this one counts

  const resend = seen.find((s) => s.url.host === 'api.resend.com');
  const payload = JSON.parse(resend?.body || '{}');
  assert.equal(payload.from, 'alice@gothwadtech.com');
  assert.deepEqual(payload.to, ['bob@example.com']);
  assert.deepEqual(payload.cc, ['carol@example.com']);
  assert.equal(payload.bcc, undefined);
  assert.equal(payload.subject.includes('\n'), false, 'no header injection via subject');
  assert.equal(payload.html.includes('<b>'), false, 'user text is HTML-escaped');
  assert.equal(resend?.headers.get('authorization'), 'Bearer re_TEST_ONLY');

  const insert = seen.find((s) => s.method === 'POST' && s.url.host === 'abcdefgh.supabase.co');
  const row = JSON.parse(insert?.body || '{}');
  assert.equal(row.folder, 'sent');
  assert.equal(row.to_username, 'alice');
  assert.equal(row.provider_id, 're_msg_1');

  const del = seen.find((s) => s.method === 'DELETE');
  assert.equal(del?.url.searchParams.get('folder'), 'eq.drafts');
});

test('send stops at the daily limit with 429 and does not call Resend', async () => {
  stub = (s) => {
    const a = accountsStub(s);
    if (a) return a;
    if (s.method === 'HEAD') return new Response(null, { status: 200, headers: { 'content-range': '*/2' } });
    return new Response('x', { status: 599 });
  };
  const res = await worker.fetch(
    req('/api/mail/send', {
      method: 'POST',
      cookie: 'gothwad_at=good',
      origin: MAIL_ORIGIN,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ to: ['bob@example.com'], subject: 'x', body: 'y' }),
    }),
    baseEnv
  );
  assert.equal(res.status, 429);
  assert.equal(seen.filter((s) => s.url.host === 'api.resend.com').length, 0);
});

test('send validates recipients and refuses an empty recipient list', async () => {
  stub = (s) => accountsStub(s) ?? Response.json([]);
  const res = await worker.fetch(
    req('/api/mail/send', {
      method: 'POST',
      cookie: 'gothwad_at=good',
      origin: MAIL_ORIGIN,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ to: [], subject: 'x', body: 'y' }),
    }),
    baseEnv
  );
  assert.equal(res.status, 400);
  assert.throws(() => cleanRecipients(['not an email'], 'to'), /Invalid email/);
});

test('dev bypass is ignored in production', async () => {
  stub = (s) => accountsStub(s) ?? Response.json([]);
  const env = { ...baseEnv, DEV_AUTH_USERNAME: 'mallory' };
  const res = await worker.fetch(req('/api/mail/messages'), env);
  assert.equal(res.status, 401);
});

test('dev bypass works only with ENVIRONMENT=development', async () => {
  stub = (s) => accountsStub(s) ?? Response.json([]);
  const env = { ...baseEnv, ENVIRONMENT: 'development', DEV_AUTH_USERNAME: 'Dev.User' };
  const res = await worker.fetch(req('/api/session'), env);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).user.username, 'dev.user');
});

test('CORS: only allowlisted origins get Allow-Origin', async () => {
  stub = (s) => accountsStub(s) ?? Response.json([]);
  const ok = await handleRequest(req('/api/health', { origin: MAIL_ORIGIN }), baseEnv);
  assert.equal(ok.headers.get('access-control-allow-origin'), MAIL_ORIGIN);
  const no = await handleRequest(req('/api/health', { origin: 'https://evil.example' }), baseEnv);
  assert.equal(no.headers.get('access-control-allow-origin'), null);
});

test('unknown API paths return JSON 404', async () => {
  const res = await worker.fetch(req('/api/nope'), baseEnv);
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, 'not_found');
});

test('textToHtml escapes markup and keeps line breaks', () => {
  assert.equal(textToHtml('<script>x</script>\nok'), '&lt;script&gt;x&lt;/script&gt;<br>ok');
});

test('inbound routing only accepts our APP_DOMAIN, case-insensitive', () => {
  assert.equal(localPartForDomain('Pawan@GothwadTech.com', 'gothwadtech.com'), 'pawan');
  assert.equal(localPartForDomain('pawan@gmail.com', 'gothwadtech.com'), null);
  assert.equal(localPartForDomain('@gothwadtech.com', 'gothwadtech.com'), null);
});

/** Accounts stub for inbound: "pawan" exists, and other names do not. */
function accountsUsernameStub(s: Seen): Response | null {
  if (s.url.origin !== 'https://accounts.test' || s.method !== 'GET') return null;
  const match = s.url.pathname.match(/^\/api\/internal\/usernames\/([^/]+)$/);
  if (!match) return null;
  const username = decodeURIComponent(match[1]);
  return Response.json({ exists: username === 'pawan' });
}

test('inbound email: parses MIME, stores metadata only, drops attachment bytes', async () => {
  let inserted: Record<string, unknown> | null = null;
  stub = (s) => {
    const account = accountsUsernameStub(s);
    if (account) return account;
    if (s.url.host === 'abcdefgh.supabase.co' && s.method === 'POST') {
      inserted = JSON.parse(s.body || '{}');
      return Response.json([{ id: 'in-1' }]);
    }
    return new Response('x', { status: 599 });
  };

  const eml = [
    'From: Ravi <ravi@example.org>',
    'To: Pawan <pawan@gothwadtech.com>',
    'Subject: Invoice for October',
    'Message-ID: <abc123@example.org>',
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary="BOUND"',
    '',
    '--BOUND',
    'Content-Type: text/plain; charset=utf-8',
    '',
    'Please find the invoice attached.',
    '--BOUND',
    'Content-Type: application/pdf; name="invoice.pdf"',
    'Content-Disposition: attachment; filename="invoice.pdf"',
    'Content-Transfer-Encoding: base64',
    '',
    'JVBERi0xLjQKJcOkw7zDtsOfCjIgMCBvYmoKPDwvTGVuZ3RoIDM+PgpzdHJlYW0K',
    '--BOUND--',
    '',
  ].join('\r\n');

  let rejected: string | null = null;
  const message = {
    from: 'ravi@example.org',
    to: 'pawan@gothwadtech.com',
    rawSize: eml.length,
    raw: new Response(eml).body!,
    headers: new Headers({ 'message-id': '<abc123@example.org>' }),
    setReject: (reason: string) => {
      rejected = reason;
    },
  } as unknown as ForwardableEmailMessage;

  await worker.email(message, baseEnv);
  assert.equal(rejected, null);
  assert.ok(inserted, 'row inserted');
  const row = inserted as unknown as Record<string, unknown>;
  assert.equal(row.to_username, 'pawan');
  assert.equal(row.folder, 'inbox');
  assert.equal(row.from_email, 'ravi@example.org');
  assert.equal(row.from_name, 'Ravi');
  assert.equal(row.subject, 'Invoice for October');
  assert.equal(row.body_text, 'Please find the invoice attached.');
  assert.equal(row.provider_id, '<abc123@example.org>');
  const atts = row.attachments as Array<{ name: string; type: string; size: number }>;
  assert.equal(atts.length, 1);
  assert.equal(atts[0].name, 'invoice.pdf');
  assert.equal(atts[0].type, 'application/pdf');
  assert.ok(atts[0].size > 0);
  assert.equal(JSON.stringify(row).includes('JVBERi0x'), false, 'attachment bytes are not stored');
});

test('inbound email for another domain is rejected and not stored', async () => {
  let rejected: string | null = null;
  const message = {
    from: 'x@y.com',
    to: 'pawan@gmail.com',
    rawSize: 10,
    raw: new Response('hi').body!,
    headers: new Headers(),
    setReject: (r: string) => {
      rejected = r;
    },
  } as unknown as ForwardableEmailMessage;
  await worker.email(message, baseEnv);
  assert.match(rejected ?? '', /Unknown recipient/);
  assert.equal(seen.length, 0);
});

test('inbound email over the size cap is rejected before parsing', async () => {
  let rejected: string | null = null;
  const message = {
    from: 'x@y.com',
    to: 'pawan@gothwadtech.com',
    rawSize: 999_999_999,
    raw: new Response('hi').body!,
    headers: new Headers(),
    setReject: (r: string) => {
      rejected = r;
    },
  } as unknown as ForwardableEmailMessage;
  await worker.email(message, baseEnv);
  assert.match(rejected ?? '', /too large/);
  assert.equal(seen.length, 0);
});

function inboundMessage(to: string, rawSize = 100): { msg: ForwardableEmailMessage; rejected: () => string | null } {
  let rejected: string | null = null;
  const msg = {
    from: 'x@y.com',
    to,
    rawSize,
    raw: new Response('hi').body!,
    headers: new Headers(),
    setReject: (r: string) => {
      rejected = r;
    },
  } as unknown as ForwardableEmailMessage;
  return { msg, rejected: () => rejected };
}

test('inbound email to an unknown Accounts username gets 550 and is not stored', async () => {
  stub = (s) => accountsUsernameStub(s) ?? new Response('x', { status: 599 });
  const { msg, rejected } = inboundMessage('nobody-here@gothwadtech.com');
  await worker.email(msg, baseEnv);
  assert.match(rejected() ?? '', /^550 .*Unknown recipient/);
  assert.equal(seen.some((x) => x.method === 'POST'), false, 'no row inserted');
  assert.equal(seen.some((x) => x.url.host === 'abcdefgh.supabase.co'), false, 'no Mail DB call');
});

test('inbound Accounts 401 gets 451 and is not stored', async () => {
  stub = (s) =>
    s.url.pathname.startsWith('/api/internal/usernames/')
      ? Response.json({ error: 'unauthorized' }, { status: 401 })
      : new Response('x', { status: 599 });
  const { msg, rejected } = inboundMessage('pawan@gothwadtech.com');
  await worker.email(msg, baseEnv);
  assert.match(rejected() ?? '', /^451 4\.3\.0 Temporary failure, please retry later/);
  assert.equal(seen.some((x) => x.method === 'POST'), false, 'no row inserted');
});

test('inbound Accounts network failure gets 451 and is not stored', async () => {
  stub = (s) => {
    if (s.url.pathname.startsWith('/api/internal/usernames/')) return Promise.reject(new TypeError('network down'));
    return new Response('x', { status: 599 });
  };
  const { msg, rejected } = inboundMessage('pawan@gothwadtech.com');
  await worker.email(msg, baseEnv);
  assert.match(rejected() ?? '', /^451 4\.3\.0 Temporary failure, please retry later/);
  assert.equal(seen.some((x) => x.method === 'POST'), false, 'no row inserted');
});

test('inbound Accounts timeout gets 451 and is not stored', async () => {
  stub = (s) => {
    if (s.url.pathname.startsWith('/api/internal/usernames/')) {
      assert.ok(s.signal instanceof AbortSignal, 'lookup has an abort timeout');
      return Promise.reject(new DOMException('operation timed out', 'TimeoutError'));
    }
    return new Response('x', { status: 599 });
  };
  const { msg, rejected } = inboundMessage('pawan@gothwadtech.com');
  await worker.email(msg, baseEnv);
  assert.match(rejected() ?? '', /^451 4\.3\.0 Temporary failure, please retry later/);
  assert.equal(seen.some((x) => x.method === 'POST'), false, 'no row inserted');
});

test('inbound Accounts bad JSON gets 451 and is not stored', async () => {
  stub = (s) =>
    s.url.pathname.startsWith('/api/internal/usernames/')
      ? new Response('{not-json', { status: 200 })
      : new Response('x', { status: 599 });
  const { msg, rejected } = inboundMessage('pawan@gothwadtech.com');
  await worker.email(msg, baseEnv);
  assert.match(rejected() ?? '', /^451 4\.3\.0 Temporary failure, please retry later/);
  assert.equal(seen.some((x) => x.method === 'POST'), false, 'no row inserted');
});

test('inbound missing Accounts token gets 451 without any request or insert', async () => {
  stub = () => new Response('unexpected request', { status: 599 });
  const { msg, rejected } = inboundMessage('pawan@gothwadtech.com');
  const env: Env = { ...baseEnv, ACCOUNTS_INTERNAL_TOKEN: undefined };
  await worker.email(msg, env);
  assert.match(rejected() ?? '', /^451 4\.3\.0 Temporary failure, please retry later/);
  assert.equal(seen.length, 0, 'no Accounts or Supabase call');
});

test('inbound sends the Accounts token only in the Authorization header', async () => {
  stub = (s) => {
    const account = accountsUsernameStub(s);
    if (account) return account;
    if (s.url.host === 'abcdefgh.supabase.co' && s.method === 'POST') return Response.json([{ id: 'in-1' }]);
    return new Response('x', { status: 599 });
  };
  const { msg, rejected } = inboundMessage('Pawan@gothwadtech.com');
  await worker.email(msg, baseEnv);
  assert.equal(rejected(), null);
  const lookup = seen.find((s) => s.url.pathname === '/api/internal/usernames/pawan');
  assert.ok(lookup, 'Accounts username endpoint was called with the lowercased local part');
  assert.equal(lookup.headers.get('authorization'), `Bearer ${ACCOUNTS_TOKEN}`);
  assert.equal(lookup.url.search, '', 'the token is not in the query string');
  assert.equal(lookup.url.href.includes(ACCOUNTS_TOKEN), false, 'the token is not in the URL');
});

test('inbound name with a bad shape is rejected before any Accounts call', async () => {
  stub = (s) => accountsUsernameStub(s) ?? new Response('x', { status: 599 });
  const { msg, rejected } = inboundMessage('-bad@gothwadtech.com');
  await worker.email(msg, baseEnv);
  assert.match(rejected() ?? '', /^550 /);
  assert.equal(seen.length, 0, 'no Accounts or Supabase call');
});

test('rotated Accounts cookies are passed to the browser; other cookies are dropped', async () => {
  // Accounts rotates the refresh token on /auth/me. If Mail dropped the new
  // Set-Cookie, the browser would keep a revoked token and get signed out.
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
  const res = await handleRequest(req('/api/session', { cookie: 'gothwad_at=old; gothwad_rt=old' }), baseEnv);
  assert.equal(res.status, 200);
  const cookies = res.headers.getSetCookie();
  assert.ok(cookies.some((c) => c.startsWith('gothwad_at=NEW_AT')), 'rotated access cookie is forwarded');
  assert.ok(cookies.some((c) => c.startsWith('gothwad_rt=NEW_RT')), 'rotated refresh cookie is forwarded');
  assert.equal(cookies.some((c) => c.startsWith('evil=')), false, 'non-Accounts cookies are not forwarded');
  // The Accounts body (which can include tokens) must never reach the browser.
  const text = await res.text();
  assert.equal(text.includes('NEW_AT'), false, 'token values from the body are not echoed');
});

test('Accounts answering 200 with authenticated:false counts as signed out', async () => {
  stub = (s) =>
    s.url.host === 'accounts.test'
      ? new Response(JSON.stringify({ authenticated: false }), { status: 200 })
      : new Response('x', { status: 599 });
  const res = await handleRequest(req('/api/session', { cookie: 'gothwad_at=stale' }), baseEnv);
  assert.equal(res.status, 401);
  const body = (await res.json()) as { error: string; signinUrl: string };
  assert.equal(body.error, 'unauthenticated');
  assert.match(body.signinUrl, /^https:\/\/accounts\.test\/signin/);
});

test('malformed percent-encoding in a message id is a 400, not a 500', async () => {
  stub = accountsStub;
  const res = await handleRequest(req('/api/mail/messages/%E0%A4%A', { cookie: 'session=good' }), baseEnv);
  assert.equal(res.status, 400);
  assert.equal(((await res.json()) as { error: string }).error, 'bad_request');
});
