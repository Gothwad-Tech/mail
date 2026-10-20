// Account switcher proxy (see worker/src/accounts.ts).
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
// Account switcher (see worker/src/accounts.ts)
//
// Accounts is stubbed: these tests prove Mail's proxy, validation, unread
// counts and cookie forwarding, not Accounts' own behaviour.
// ---------------------------------------------------------------------------

interface SwitchStubOptions {
  list?: () => Response;
  switchRes?: () => Response;
  signoutRes?: () => Response;
}

/** Accounts h.stub with the multi-account API. */
function switcherStub(opts: SwitchStubOptions = {}): Stub {
  return (s) => {
    if (s.url.host !== 'accounts.test') return new Response('x', { status: 599 });
    if (s.url.pathname === '/api/auth/me') {
      return Response.json({ authenticated: true, user: { username: 'alice' } });
    }
    if (s.url.pathname === '/api/auth/accounts' && s.method === 'GET') {
      return opts.list ? opts.list() : accountsListResponse();
    }
    if (s.url.pathname === '/api/auth/switch' && s.method === 'POST') {
      return opts.switchRes ? opts.switchRes() : accountsListResponse('b');
    }
    if (s.url.pathname.startsWith('/api/auth/accounts/') && s.method === 'POST') {
      return opts.signoutRes ? opts.signoutRes() : accountsListResponse('a');
    }
    return new Response('x', { status: 599 });
  };
}

function accountsListResponse(activeId = 'a', extra: Array<Record<string, unknown>> = []): Response {
  const body = {
    activeId,
    accounts: [
      { id: 'a', username: 'alice', firstName: 'Alice', lastName: 'Sharma', lastUsedAt: '2026-10-20T10:00:00.000Z' },
      { id: 'b', username: 'bob', firstName: 'Bob', lastName: '', lastUsedAt: '2026-10-19T10:00:00.000Z' },
      ...extra,
    ],
  };
  const res = new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
  // Accounts rotates a session cookie on every authenticated call.
  res.headers.append('set-cookie', `gothwad_sess_${activeId}=rotated; Path=/; Domain=.gothwadtech.com; HttpOnly`);
  return res;
}

function switchWrite(id: unknown): RequestInit {
  return {
    method: 'POST',
    origin: MAIL_ORIGIN,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id }),
  };
}

test('accounts: lists both signed-in accounts with per-account unread counts', async () => {
  await seedMessage({ username: 'alice' });
  await seedMessage({ username: 'alice' });
  await seedMessage({ username: 'alice', read: true });
  await seedMessage({ username: 'bob', read: true });
  await seedMessage({ username: 'bob', folder: 'trash' }); // trash is not counted

  h.stub = switcherStub();
  const res = await worker.fetch(authed('/api/mail/accounts'), h.env);
  assert.equal(res.status, 200);
  const body = await res.json();

  assert.equal(body.activeId, 'a');
  assert.equal(body.accounts.length, 2);
  assert.deepEqual(body.accounts[0], {
    id: 'a',
    username: 'alice',
    name: 'Alice Sharma',
    email: 'alice@gothwadtech.com',
    lastUsedAt: '2026-10-20T10:00:00.000Z',
  });
  // Derived server-side, never taken from Accounts' body.
  assert.equal(body.accounts[1].email, 'bob@gothwadtech.com');
  assert.equal(body.accounts[1].name, 'Bob');
  assert.deepEqual(body.unread, { alice: 2, bob: 0 });
  assert.equal(body.unsupported, undefined);
});

test('accounts: unread counts are only computed for the verified list', async () => {
  await seedMessage({ username: 'carol' }); // never appears in Accounts' list
  await seedMessage({ username: 'alice', read: true });

  h.stub = switcherStub();
  const res = await worker.fetch(authed('/api/mail/accounts'), h.env);
  const body = await res.json();
  assert.equal('carol' in body.unread, false);
  assert.deepEqual(body.unread, { alice: 0, bob: 0 });
});

test('accounts: drops rows with a bad slot id, a bad username or a duplicate id', async () => {
  h.stub = switcherStub({
    list: () =>
      accountsListResponse('a', [
        { id: 'Z', username: 'mallory' },
        { id: 'c', username: 'not valid!' },
        { id: 'a', username: 'duplicate' },
        { id: 'd', firstName: 'Solo' },
      ]),
  });
  const res = await worker.fetch(authed('/api/mail/accounts'), h.env);
  const body = await res.json();
  assert.deepEqual(
    body.accounts.map((a: { id: string }) => a.id),
    ['a', 'b']
  );
});

test('accounts: an activeId that is not in the list falls back to the first account', async () => {
  h.stub = switcherStub({ list: () => accountsListResponse('z') });
  const res = await worker.fetch(authed('/api/mail/accounts'), h.env);
  const body = await res.json();
  assert.equal(body.activeId, 'a');
});

test('accounts: a 404 from Accounts means "switcher not deployed", not an error', async () => {
  h.stub = switcherStub({ list: () => Response.json({ error: 'not_found' }, { status: 404 }) });
  const res = await worker.fetch(authed('/api/mail/accounts'), h.env);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body, { activeId: null, accounts: [], unread: {}, unsupported: true });
});

test('accounts: a 401 from Accounts is a 401 for the browser, with signinUrl', async () => {
  h.stub = switcherStub({ list: () => Response.json({ error: 'invalid_token' }, { status: 401 }) });
  const res = await worker.fetch(authed('/api/mail/accounts'), h.env);
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.equal(body.error, 'unauthenticated');
  assert.equal(body.signinUrl, 'https://accounts.test/signin?choose=1');
});

test('accounts: an Accounts 500 becomes a 503, never a sign-out', async () => {
  h.stub = switcherStub({ list: () => Response.json({ error: 'boom' }, { status: 500 }) });
  const res = await worker.fetch(authed('/api/mail/accounts'), h.env);
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error, 'auth_unavailable');
});

test('accounts: an Accounts redirect is an unexpected answer, not a sign-out', async () => {
  h.stub = switcherStub({
    list: () => new Response(null, { status: 302, headers: { location: 'https://elsewhere.test/' } }),
  });
  const res = await worker.fetch(authed('/api/mail/accounts'), h.env);
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error, 'accounts_unexpected_response');
});

test('accounts: switch proxies the slot id and forwards the rotated cookie', async () => {
  h.stub = switcherStub();
  const res = await worker.fetch(authed('/api/mail/accounts/switch', switchWrite('b')), h.env);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.activeId, 'b');

  const upstream = h.seen.find((s) => s.url.pathname === '/api/auth/switch');
  assert.ok(upstream, 'Accounts was called');
  assert.equal(upstream!.method, 'POST');
  assert.equal(upstream!.body, JSON.stringify({ id: 'b' }));
  assert.equal(upstream!.headers.get('cookie'), 'gothwad_at=good');
  assert.match(res.headers.get('set-cookie') || '', /gothwad_sess_b=rotated/);
});

test('accounts: switch rejects an unknown slot id without calling Accounts', async () => {
  h.stub = switcherStub();
  const res = await worker.fetch(authed('/api/mail/accounts/switch', switchWrite('../x')), h.env);
  assert.equal(res.status, 400);
  assert.equal(h.seen.length, 0);
});

test('accounts: switch is a CSRF-guarded write', async () => {
  h.stub = switcherStub();
  const res = await worker.fetch(
    req('/api/mail/accounts/switch', {
      method: 'POST',
      cookie: 'gothwad_at=good',
      origin: 'https://evil.test',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'b' }),
    }),
    h.env
  );
  assert.equal(res.status, 403);
  assert.equal((await res.json()).error, 'bad_origin');
  assert.equal(h.seen.length, 0);
});

test('accounts: switch to a slot whose session is gone is a 409 the UI can act on', async () => {
  h.stub = switcherStub({
    switchRes: () => Response.json({ error: 'account_not_signed_in' }, { status: 409 }),
  });
  const res = await worker.fetch(authed('/api/mail/accounts/switch', switchWrite('c')), h.env);
  assert.equal(res.status, 409);
  assert.equal((await res.json()).error, 'account_not_signed_in');
});

test('accounts: signout proxies to the per-account endpoint', async () => {
  h.stub = switcherStub();
  const res = await worker.fetch(authed('/api/mail/accounts/signout', switchWrite('b')), h.env);
  assert.equal(res.status, 200);
  const upstream = h.seen.find((s) => s.url.pathname === '/api/auth/accounts/b/signout');
  assert.ok(upstream, 'the per-account signout endpoint was called');
});

test('accounts: "add another account" redirects to Accounts in append mode', async () => {
  h.stub = switcherStub();
  const res = await worker.fetch(authed('/api/mail/accounts/add'), h.env);
  assert.equal(res.status, 302);
  const location = new URL(res.headers.get('location')!);
  assert.equal(location.origin, 'https://accounts.test');
  assert.equal(location.pathname, '/signin');
  assert.equal(location.searchParams.get('choose'), '1');
  assert.equal(location.searchParams.get('add'), '1');
  assert.equal(location.searchParams.get('next'), 'https://mail.test/');
 });
