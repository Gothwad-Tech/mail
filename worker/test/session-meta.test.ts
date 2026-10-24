// =============================================================================
// The split session endpoints.
//
// Startup used to wait for everything: Accounts verification, the send count and
// the unread badges. Only the first of those is required to render the shell.
// These tests pin the contract that makes the split safe:
//
//   GET /api/session?meta=0   identity only, zero database work
//   GET /api/session          identity + metadata (unchanged shape)
//   GET /api/session/meta     unread + quota, its own verification
//
// and the rules that must survive the split: unknown counts stay `null`, a
// signed-out browser is the only thing that redirects, every other failure is a
// retryable error, and rotated cookies are forwarded as separate headers.
// =============================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.ts';
import { h, authed, req, seedMessage, makeEnv, type Seen, type Stub } from './helpers.ts';

/** Accounts stub that answers /auth/me for the cookie gothwad_at=good. */
function accountsMe(body: unknown = { authenticated: true, user: { username: 'alice', first_name: 'Alice' } }): Stub {
  return (s: Seen) => {
    if (s.url.origin !== 'https://accounts.test') return new Response('x', { status: 599 });
    if (s.url.pathname === '/api/auth/me') return Response.json(body);
    return new Response('x', { status: 599 });
  };
}

test('identity-only session does no database work at all', async () => {
  h.stub = accountsMe();
  await seedMessage({ subject: 'Unread one' });

  // No D1 binding: any query would throw. The identity response must not care.
  const env = makeEnv({ DB: undefined });
  const res = await worker.fetch(authed('/api/session?meta=0'), env);

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.authenticated, true);
  assert.equal(body.user.username, 'alice');
  assert.equal(body.authuser, 0);
  assert.equal(body.accounts.length, 0, 'a single-account session has an empty switcher list');
  assert.equal(body.meta, false, 'the app can see that metadata is still missing');
  assert.equal(body.unread, null, 'unknown, not zero');
  assert.equal(body.limits, null, 'unknown, not zero');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(h.seen.length, 1, 'exactly one upstream call: Accounts verification');
});

test('the full session keeps its old shape and real numbers', async () => {
  h.stub = accountsMe();
  await seedMessage({ subject: 'Unread one' });
  await seedMessage({ folder: 'sent', read: true });

  const res = await worker.fetch(authed('/api/session'), h.env);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.meta, true);
  assert.deepEqual(body.unread, {}, 'no accounts[] means no badges, and that is a known answer');
  assert.equal(body.limits.dailySendLimit, 2);
  assert.equal(body.limits.sendRemainingToday, 1);
});

test('a broken database turns metadata into null, never into zeros', async () => {
  // The accounts list is what makes the unread query real: with no accounts
  // there is nothing to count, and an empty map is a true answer.
  h.stub = accountsMe({
    authenticated: true,
    user: { username: 'alice' },
    accounts: [
      { id: 'a', authuser: 0, username: 'alice' },
      { id: 'b', authuser: 1, username: 'bob' },
    ],
  });
  const env = makeEnv({ DB: undefined });

  const res = await worker.fetch(authed('/api/session'), env);
  assert.equal(res.status, 200, 'a verified session still works without D1');
  const body = await res.json();
  assert.equal(body.unread, null, 'no "0 unread" claim when the count failed');
  assert.equal(body.limits.sendRemainingToday, null);
  assert.equal(body.limits.dailySendLimit, 2, 'the configured cap is always known');
});

test('the metadata endpoint returns badges and quota for this tab account', async () => {
  h.stub = accountsMe({
    authenticated: true,
    user: { username: 'bob', first_name: 'Bob' },
    authuser: 1,
    activeId: 'b',
    accounts: [
      { id: 'a', authuser: 0, username: 'alice', firstName: 'Alice' },
      { id: 'b', authuser: 1, username: 'bob', firstName: 'Bob' },
    ],
  });
  await seedMessage({ username: 'alice' });
  await seedMessage({ username: 'alice' });
  await seedMessage({ username: 'bob' });

  const res = await worker.fetch(authed('/api/session/meta', { headers: { 'X-Gothwad-Authuser': '1' } }), h.env);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.meta, true);
  assert.equal(body.authuser, 1, 'the response names the account it describes');
  assert.deepEqual(body.unread, { alice: 2, bob: 1 });
  assert.equal(body.limits.dailySendLimit, 2);
  assert.equal(body.limits.sendRemainingToday, 2);

  const upstream = h.seen.filter((s) => s.url.pathname === '/api/auth/me');
  assert.equal(upstream.length, 1, 'one verification for one request');
  assert.equal(upstream[0].headers.get('x-gothwad-authuser'), '1', 'this tab selector is forwarded');
});

test('anonymous: both endpoints answer 401 with the sign-in link', async () => {
  h.stub = () => Response.json({ authenticated: false }, { status: 401 });

  for (const path of ['/api/session?meta=0', '/api/session', '/api/session/meta']) {
    const res = await worker.fetch(req(path, { cookie: 'gothwad_at=stale' }), h.env);
    assert.equal(res.status, 401, `${path} must be the only sign-out answer`);
    const body = await res.json();
    assert.equal(body.error, 'unauthenticated');
    assert.equal(body.signinUrl, 'https://accounts.test/signin?choose=1');
  }
});

test('upstream failures are retryable 503s, never a fake sign-out', async () => {
  const cases: Array<{ name: string; response: Response; code: string }> = [
    { name: 'offline', response: new Response('', { status: 503 }), code: 'auth_unavailable' },
    { name: '429 rate limit', response: new Response('slow down', { status: 429 }), code: 'auth_unavailable' },
    { name: '500', response: new Response('boom', { status: 500 }), code: 'auth_unavailable' },
    { name: 'html', response: new Response('<html>login</html>', { status: 200 }), code: 'accounts_unexpected_response' },
    {
      name: 'redirect',
      response: new Response(null, { status: 302, headers: { location: 'https://accounts.test/signin' } }),
      code: 'accounts_unexpected_response',
    },
    { name: 'bad payload', response: Response.json({ authenticated: 'yes' }), code: 'accounts_unexpected_response' },
  ];

  for (const item of cases) {
    h.stub = (s: Seen) =>
      s.url.pathname === '/api/auth/me' ? item.response.clone() : new Response('x', { status: 599 });

    for (const path of ['/api/session?meta=0', '/api/session/meta']) {
      const res = await worker.fetch(authed(path), h.env);
      assert.equal(res.status, 503, `${item.name} on ${path} must be a 503`);
      const body = await res.json();
      assert.equal(body.error, item.code, `${item.name} on ${path}`);
      assert.equal(body.signinUrl, undefined, `${item.name} must not offer a sign-in redirect`);
    }
  }
});

test('a network error from Accounts is a 503 too', async () => {
  h.stub = () => {
    throw new Error('network down');
  };
  for (const path of ['/api/session?meta=0', '/api/session/meta']) {
    const res = await worker.fetch(authed(path), h.env);
    assert.equal(res.status, 503);
    assert.equal((await res.json()).error, 'auth_unavailable');
  }
});

test('rotated session cookies are forwarded separately from both calls', async () => {
  const cookies = [
    'gothwad_at=NEW_A; Domain=.gothwadtech.com; Path=/; HttpOnly',
    'gothwad_rt=NEW_R; Domain=.gothwadtech.com; Path=/; HttpOnly',
  ];
  h.stub = (s: Seen) => {
    if (s.url.pathname !== '/api/auth/me') return new Response('x', { status: 599 });
    const headers = new Headers({ 'content-type': 'application/json' });
    for (const cookie of cookies) headers.append('set-cookie', cookie);
    return new Response(JSON.stringify({ authenticated: true, user: { username: 'alice' } }), {
      status: 200,
      headers,
    });
  };

  for (const path of ['/api/session?meta=0', '/api/session/meta']) {
    const res = await worker.fetch(authed(path), h.env);
    assert.equal(res.status, 200, path);
    const forwarded = res.headers.getSetCookie();
    assert.equal(forwarded.length, 2, `${path}: one Set-Cookie header per rotated cookie`);
    assert.match(forwarded[0], /^gothwad_at=NEW_A/);
    assert.match(forwarded[1], /^gothwad_rt=NEW_R/);
  }
});

test('the tab selector is forwarded and never leaks into the identity of another tab', async () => {
  h.stub = (s: Seen) => {
    if (s.url.pathname !== '/api/auth/me') return new Response('x', { status: 599 });
    const selector = s.headers.get('x-gothwad-authuser');
    const username = selector === '1' ? 'bob' : 'alice';
    return Response.json({
      authenticated: true,
      user: { username },
      authuser: selector === '1' ? 1 : 0,
      accounts: [
        { id: 'a', authuser: 0, username: 'alice' },
        { id: 'b', authuser: 1, username: 'bob' },
      ],
    });
  };

  const [tabZero, tabOne] = await Promise.all([
    worker.fetch(authed('/api/session?meta=0', { headers: { 'X-Gothwad-Authuser': '0' } }), h.env),
    worker.fetch(authed('/api/session?meta=0', { headers: { 'X-Gothwad-Authuser': '1' } }), h.env),
  ]);

  assert.equal((await tabZero.json()).user.username, 'alice');
  assert.equal((await tabOne.json()).user.username, 'bob');
  const selectors = h.seen.map((s) => s.headers.get('x-gothwad-authuser'));
  assert.deepEqual(selectors, ['0', '1'], 'each request carried its own selector');
});
