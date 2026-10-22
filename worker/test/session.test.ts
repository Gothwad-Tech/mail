// Session + Accounts handoff rules (a 401 must only ever mean "signed out").
//
// Split out of worker.test.ts so no test file grows past a few hundred
// lines; the harness in helpers.ts is shared. Run: npm run test:worker

import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker, { handleRequest } from '../src/index.ts';
import { textToHtml, cleanRecipients } from '../src/mail.ts';
import { localPartForDomain } from '../src/inbound.ts';
import { Db } from '../src/db.ts';
import {
  h,
  MAIL_ORIGIN,
  req,
  authed,
  writeInit,
  seedMessage,
  countRows,
  fullStub,
  accountsStub,
  accountsMeStub,
  hubOnlyStub,
  sessionResponse,
  inboundMessage,
  makeEnv,
  ACCOUNTS_TOKEN,
  RESEND_KEY,
  parsePatch,
  type Seen,
  type Stub,
  type Env,
} from './helpers.ts';

// ---------------------------------------------------------------------------
// Session / Accounts handoff (these rules must never regress)
// ---------------------------------------------------------------------------

test('unauthenticated list returns 401 with the Accounts signin base URL', async () => {
  h.stub = fullStub;
  const res = await worker.fetch(req('/api/mail/messages'), h.env);
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.equal(body.error, 'unauthenticated');
  assert.equal(body.signinUrl, 'https://accounts.test/signin?choose=1');
});


test('Accounts 401 -> Mail 401 with signinUrl (real signed-out answer)', async () => {
  h.stub = accountsMeStub(() => Response.json({ error: 'invalid_token' }, { status: 401 }));
  const { res, body } = await sessionResponse();
  assert.equal(res.status, 401);
  assert.equal(body.error, 'unauthenticated');
  assert.equal(body.signinUrl, 'https://accounts.test/signin?choose=1');
});

test('Accounts 403 -> Mail 401 with signinUrl', async () => {
  h.stub = accountsMeStub(() => Response.json({ error: 'forbidden' }, { status: 403 }));
  const { res, body } = await sessionResponse();
  assert.equal(res.status, 401);
});

test('Accounts 302 -> Mail 503 accounts_unexpected_response (never followed)', async () => {
  h.stub = accountsMeStub(
    () => new Response(null, { status: 302, headers: { location: 'https://accounts.test/signin' } })
  );
  const { res, body } = await sessionResponse();
  assert.equal(res.status, 503);
  assert.equal(body.error, 'accounts_unexpected_response');
  assert.equal(body.signinUrl, undefined, 'a 503 must not carry a sign-in link');
  assert.equal(body.upstreamStatus, 302);
  assert.equal(h.seen.find((s) => s.url.host === 'accounts.test')?.redirect, 'manual');
});

test('Accounts 200 with an HTML body -> Mail 503 accounts_unexpected_response', async () => {
  h.stub = accountsMeStub(
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
  h.stub = accountsMeStub(
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
  h.stub = accountsMeStub(() => Response.json({ user: { username: 'pawan' } }));
  const { res, body } = await sessionResponse();
  assert.equal(res.status, 503);
  assert.equal(body.error, 'accounts_unexpected_response');
});

test('Accounts authenticated without a usable username -> 503 accounts_user_invalid', async () => {
  h.stub = accountsMeStub(() => Response.json({ authenticated: true, user: { username: '' } }));
  const { res, body } = await sessionResponse();
  assert.equal(res.status, 503);
  assert.equal(body.error, 'accounts_user_invalid');
  assert.equal(body.signinUrl, undefined, 'the user IS signed in, so no sign-in link');
});

test('Accounts unreachable -> 503 auth_unavailable', async () => {
  h.stub = () => {
    throw new Error('connect ECONNREFUSED');
  };
  const { res, body } = await sessionResponse();
  assert.equal(res.status, 503);
  assert.equal(body.error, 'auth_unavailable');
});

test('Accounts outage gives 503, not a fake signed-out state', async () => {
  h.stub = () => new Response('boom', { status: 500 });
  const res = await worker.fetch(req('/api/session', { cookie: 'gothwad_at=good' }), h.env);
  assert.equal(res.status, 503);
});

test('failures log one warn line with status, content-type and code (no secrets)', async () => {
  const warns: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warns.push(args.map(String).join(' '));
  };
  try {
    h.stub = accountsMeStub(
      () => new Response('<html>SECRET_BODY</html>', { status: 200, headers: { 'content-type': 'text/html' } })
    );
    await handleRequest(req('/api/session', { cookie: 'gothwad_at=SECRET_COOKIE_VALUE' }), h.env);
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
  h.stub = hubOnlyStub((s) =>
    s.url.pathname === '/api/auth/me'
      ? Response.json({ authenticated: false }, { status: 401 })
      : new Response('x', { status: 599 })
  );
  const res = await handleRequest(req('/api/session', { cookie: 'gothwad_at=fresh' }), custom);
  assert.equal(res.status, 401);
  const body = (await res.json()) as { error: string; signinUrl: string };
  assert.equal(body.signinUrl, 'https://accounts.test/signin?choose=1');
  assert.deepEqual(
    h.seen.map((s) => s.url.origin),
    ['https://api.test'],
    'server-side calls use the Custom Domain only'
  );
});

test('accountUrl uses AUTH_SIGNIN_URL and /api/auth/me still uses AUTH_HUB_URL', async () => {
  const custom = splitEnv();
  h.stub = hubOnlyStub((s) =>
    s.url.pathname === '/api/auth/me'
      ? Response.json({ authenticated: true, user: { username: 'alice', first_name: 'Alice' } })
      : new Response('x', { status: 599 })
  );
  const res = await handleRequest(req('/api/session', { cookie: 'gothwad_at=good' }), custom);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { accountUrl: string; authuser: number };
  // Google-style per-account profile page; index 0 because no accounts[] came back.
  assert.equal(body.accountUrl, 'https://accounts.test/u/0/me');
  assert.equal(body.authuser, 0);
  assert.equal(h.seen.find((s) => s.url.pathname === '/api/auth/me')?.url.origin, 'https://api.test');
  assert.equal(h.seen.some((s) => s.url.host === 'accounts.test'), false);
});

test('bearer token path uses userinfo on AUTH_HUB_URL and derives the email', async () => {
  const custom = splitEnv();
  h.stub = hubOnlyStub((s) =>
    s.url.pathname === '/api/oauth/userinfo'
      ? Response.json({ sub: '1', preferred_username: 'alice', name: 'Alice' })
      : new Response('x', { status: 599 })
  );
  const res = await worker.fetch(req('/api/session', { headers: { authorization: 'Bearer goodtoken' } }), custom);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.user.email, 'alice@gothwadtech.com');
  assert.equal(body.user.name, 'Alice');
  assert.equal(h.seen.find((s) => s.url.pathname === '/api/oauth/userinfo')?.url.origin, 'https://api.test');
});

test('session returns derived email and remaining sends counted from D1', async () => {
  h.stub = fullStub;
  await seedMessage({ folder: 'sent', daysAgo: 0 });
  const res = await worker.fetch(authed('/api/session'), h.env);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.user.username, 'alice');
  assert.equal(body.user.email, 'alice@gothwadtech.com');
  assert.equal(body.user.name, 'Alice Sharma');
  assert.equal(body.limits.sendRemainingToday, 1, 'limit 2, one sent today');
  assert.equal(body.accountUrl, 'https://accounts.test/u/0/me');
});

test('rotated Accounts cookies are forwarded; other cookies are dropped', async () => {
  h.stub = (s) => {
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
  const res = await handleRequest(req('/api/session', { cookie: 'gothwad_at=old; gothwad_rt=old' }), h.env);
  assert.equal(res.status, 200);
  const cookies = res.headers.getSetCookie();
  assert.ok(cookies.some((c) => c.startsWith('gothwad_at=NEW_AT')));
  assert.ok(cookies.some((c) => c.startsWith('gothwad_rt=NEW_RT')));
  assert.equal(cookies.some((c) => c.startsWith('evil=')), false);
  assert.equal((await res.text()).includes('NEW_AT'), false, 'token values are not echoed');
});

test('dev bypass works only with ENVIRONMENT=development', async () => {
  h.stub = fullStub;
  const res = await worker.fetch(req('/api/session'), makeEnv({ ENVIRONMENT: 'development', DEV_AUTH_USERNAME: 'pawan' }));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).user.email, 'pawan@gothwadtech.com');

  const prod = await worker.fetch(req('/api/session'), makeEnv({ DEV_AUTH_USERNAME: 'pawan' }));
  assert.equal(prod.status, 401, 'the bypass is ignored in production');
});

test('the session carries the identity the account widget draws', async () => {
  h.stub = (s) =>
    s.url.host === 'accounts.test'
      ? Response.json({
          authenticated: true,
          user: {
            username: 'alice',
            first_name: 'Alice',
            last_name: 'Sharma',
            avatar_url: 'https://cdn.test/alice.png',
          },
        })
      : new Response('x', { status: 599 });

  const res = await worker.fetch(authed('/api/session'), h.env);
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    user: { name: string; firstName: string; lastName: string; avatarUrl: string | null };
    accountsWebOrigin: string;
  };
  assert.equal(body.user.name, 'Alice Sharma');
  assert.equal(body.user.firstName, 'Alice', 'initials come from the name parts');
  assert.equal(body.user.lastName, 'Sharma');
  assert.equal(body.user.avatarUrl, 'https://cdn.test/alice.png');
  // The browser loads `${accountsWebOrigin}/widget/account-menu.js`, so the
  // origin must come from config, not from a hardcoded domain in the bundle.
  assert.equal(body.accountsWebOrigin, 'https://accounts.test');
});

test('a user without a photo or name parts still produces a usable session', async () => {
  h.stub = (s) =>
    s.url.host === 'accounts.test'
      ? Response.json({ authenticated: true, user: { username: 'alice' } })
      : new Response('x', { status: 599 });

  const res = await worker.fetch(authed('/api/session'), h.env);
  const body = (await res.json()) as {
    user: { name: string | null; firstName: string; lastName: string; avatarUrl: unknown };
  };
  assert.equal(body.user.name, null);
  assert.equal(body.user.firstName, '');
  assert.equal(body.user.lastName, '');
  assert.equal(body.user.avatarUrl, null, 'never undefined: the widget checks for null');
});

test('development points the widget at the host the browser used; production uses config', async () => {
  h.stub = (s) =>
    s.url.host === 'accounts.test'
      ? Response.json({ authenticated: true, user: { username: 'alice' } })
      : new Response('x', { status: 599 });

  // Development: the local dev server serves the widget stand-in itself, so the
  // browser must be told the origin it is actually on.
  const dev = await worker.fetch(
    req('/api/session', { cookie: 'gothwad_at=good', headers: { host: '3000-preview.test' } }),
    makeEnv({ ENVIRONMENT: 'development' })
  );
  assert.equal(((await dev.json()) as { accountsWebOrigin: string }).accountsWebOrigin, 'http://3000-preview.test');

  // Production: always the configured Accounts web host, whatever Host says.
  const prod = await worker.fetch(
    req('/api/session', { cookie: 'gothwad_at=good', headers: { host: 'evil.test' } }),
    h.env
  );
  assert.equal(((await prod.json()) as { accountsWebOrigin: string }).accountsWebOrigin, 'https://accounts.test');
});
