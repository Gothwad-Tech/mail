// Account switcher proxy (see worker/src/accounts.ts) + per-tab isolation.
//
// Accounts is stubbed to the live v2.3 contract:
//   GET  /api/auth/accounts              { activeId, authuser, accounts }
//   POST /api/auth/switch  {id}|{authuser}
//   POST /api/auth/accounts/:id/signout
//   GET  /api/auth/me  (honours X-Gothwad-Authuser)
//
// What these tests protect:
//   - the tab's X-Gothwad-Authuser reaches Accounts (multi-tab correctness)
//   - every rotated Set-Cookie is forwarded, multiple headers intact
//   - a switch returns accounts + authuser + unread in one call
//   - signing one account out promotes the other instead of signing out all

import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker, { handleRequest } from '../src/index.ts';
import { Db } from '../src/db.ts';
import {
  h,
  MAIL_ORIGIN,
  req,
  authed,
  seedMessage,
  fullStub,
  makeEnv,
  type Stub,
} from './helpers.ts';

const SLOT_A = { id: 'a', authuser: 0, username: 'alice', firstName: 'Alice', lastName: 'Sharma' };
const SLOT_B = { id: 'b', authuser: 1, username: 'bob', firstName: 'Bob', lastName: 'Verma' };

function publicAccount(slot: typeof SLOT_A) {
  return {
    ...slot,
    email: `${slot.username}@gothwadtech.com`,
    avatarUrl: null,
    accountUrl: `https://accounts.test/u/${slot.authuser}/me`,
    lastUsedAt: '2026-10-20T10:00:00.000Z',
  };
}

/** Cookies the live service sets on a switch; all must reach the browser. */
function withSlotCookies(res: Response, activeId: string): Response {
  const headers = new Headers(res.headers);
  headers.append('set-cookie', `gothwad_active=${activeId}; Domain=.gothwadtech.com; Path=/; HttpOnly`);
  headers.append('set-cookie', `gothwad_sess_${activeId}=rotated; Domain=.gothwadtech.com; Path=/; HttpOnly`);
  headers.append('set-cookie', `gothwad_accounts=signed; Domain=.gothwadtech.com; Path=/; HttpOnly`);
  return new Response(res.body, { status: res.status, headers });
}

interface StubOptions {
  activeId?: string;
  accounts?: Array<typeof SLOT_A>;
  list?: () => Response;
  switchRes?: () => Response;
  signoutRes?: () => Response;
  signoutBody?: Record<string, unknown>;
}

/** A stub that behaves like Accounts v2.3 for one browser with N slots. */
function switcherStub(opts: StubOptions = {}): Stub {
  const accounts = opts.accounts ?? [SLOT_A, SLOT_B];
  const activeId = opts.activeId ?? 'a';
  const body = (active: string) => ({
    activeId: active,
    authuser: Math.max(0, accounts.findIndex((a) => a.id === active)),
    accounts: accounts.map(publicAccount),
  });

  return (s) => {
    if (s.url.host !== 'accounts.test') return new Response('x', { status: 599 });

    if (s.url.pathname === '/api/auth/me') {
      // The selector can be an index, a slot id or a username, like upstream.
      const selector = (s.headers.get('x-gothwad-authuser') || '').trim().toLowerCase();
      const chosen =
        accounts.find((a) => String(a.authuser) === selector) ??
        accounts.find((a) => a.id === selector) ??
        accounts.find((a) => a.username === selector) ??
        accounts.find((a) => a.id === activeId) ??
        accounts[0];
      return withSlotCookies(
        Response.json({
          authenticated: true,
          user: { username: chosen.username, first_name: chosen.firstName, last_name: chosen.lastName },
          ...body(chosen.id),
        }),
        chosen.id
      );
    }

    if (s.url.pathname === '/api/auth/accounts' && s.method === 'GET') {
      return opts.list ? withSlotCookies(opts.list(), activeId) : withSlotCookies(Response.json(body(activeId)), activeId);
    }
    if (s.url.pathname === '/api/auth/switch' && s.method === 'POST') {
      if (opts.switchRes) return withSlotCookies(opts.switchRes(), 'b');
      const parsed = JSON.parse(s.body || '{}') as { id?: string; authuser?: number };
      const target =
        accounts.find((a) => a.id === parsed.id) ?? accounts.find((a) => a.authuser === parsed.authuser);
      return withSlotCookies(
        Response.json({ ok: true, ...body(target ? target.id : 'b') }),
        target ? target.id : 'b'
      );
    }
    if (s.url.pathname.startsWith('/api/auth/accounts/') && s.method === 'POST') {
      if (opts.signoutRes) return withSlotCookies(opts.signoutRes(), 'a');
      const remaining = accounts.filter((a) => !s.url.pathname.includes(`/${a.id}/signout`));
      const next = remaining[0];
      return withSlotCookies(
        Response.json({
          ok: true,
          signedOutAll: remaining.length === 0,
          activeId: next?.id ?? null,
          authuser: next?.authuser ?? null,
          accounts: remaining.map(publicAccount),
          ...(opts.signoutBody ?? {}),
        }),
        next?.id ?? 'a'
      );
    }
    return new Response('x', { status: 599 });
  };
}

test('accounts: lists both accounts with per-account unread counts', async () => {
  await seedMessage({ username: 'alice' });
  await seedMessage({ username: 'alice' });
  await seedMessage({ username: 'alice', read: true });
  await seedMessage({ username: 'bob', read: true });

  h.stub = switcherStub();
  const res = await worker.fetch(authed('/api/mail/accounts'), h.env);
  assert.equal(res.status, 200);
  const body = await res.json();

  assert.equal(body.activeId, 'a');
  assert.equal(body.authuser, 0);
  assert.equal(body.accounts.length, 2);
  assert.deepEqual(body.accounts[0], {
    id: 'a',
    authuser: 0,
    username: 'alice',
    name: 'Alice Sharma',
    firstName: 'Alice',
    lastName: 'Sharma',
    email: 'alice@gothwadtech.com',
    avatarUrl: null,
    accountUrl: 'https://accounts.test/u/0/me',
    lastUsedAt: '2026-10-20T10:00:00.000Z',
  });
  // Derived server-side, never trusted from the upstream body.
  assert.equal(body.accounts[1].email, 'bob@gothwadtech.com');
  assert.deepEqual(body.unread, { alice: 2, bob: 0 });
  assert.equal(body.unsupported, undefined);
});

test('accounts: the TAB selector decides which account is active, not the browser cookie', async () => {
  h.stub = switcherStub({ activeId: 'a' });
  const tab0 = await (await worker.fetch(authed('/api/mail/accounts'), h.env)).json();
  const tab1 = await (
    await worker.fetch(
      req('/api/mail/accounts', { cookie: 'gothwad_at=good', headers: { 'X-Gothwad-Authuser': '1' } }),
      h.env
    )
  ).json();

  // Both tabs read the same browser, and each one sees its own slot.
  assert.equal(tab0.activeId, 'a');
  assert.equal(tab0.authuser, 0);
  assert.equal(tab1.activeId, 'b');
  assert.equal(tab1.authuser, 1);
  // The selector was forwarded upstream on both calls.
  const forwarded = h.seen.filter((s) => s.url.pathname === '/api/auth/accounts').map((s) => s.headers.get('x-gothwad-authuser'));
  assert.deepEqual(forwarded, [null, '1']);
});

test('accounts: unread counts are only computed for the verified list', async () => {
  await seedMessage({ username: 'carol' }); // never appears in Accounts' list
  await seedMessage({ username: 'alice', read: true });

  h.stub = switcherStub();
  const body = await (await worker.fetch(authed('/api/mail/accounts'), h.env)).json();
  assert.equal('carol' in body.unread, false);
  assert.deepEqual(body.unread, { alice: 0, bob: 0 });
});

test('accounts: drops rows with a bad slot id, a bad username or a duplicate', async () => {
  h.stub = switcherStub({
    list: () =>
      Response.json({
        activeId: 'a',
        authuser: 0,
        accounts: [
          ...accountsList(),
          { id: 'Z', username: 'mallory' },
          { id: 'c', username: 'not valid!' },
          { id: 'a', username: 'duplicate' },
          { id: 'd', firstName: 'Solo' },
        ],
      }),
  });
  const body = await (await worker.fetch(authed('/api/mail/accounts'), h.env)).json();
  assert.deepEqual(
    body.accounts.map((a: { id: string }) => a.id),
    ['a', 'b']
  );
});

function accountsList() {
  return [publicAccount(SLOT_A), publicAccount(SLOT_B)];
}

test('accounts: a 404 from Accounts means "switcher not deployed", not an error', async () => {
  h.stub = switcherStub({ list: () => Response.json({ error: 'not_found' }, { status: 404 }) });
  const res = await worker.fetch(authed('/api/mail/accounts'), h.env);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body, { activeId: null, authuser: null, accounts: [], unread: {}, unsupported: true });
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

test('accounts: switch by id forwards Origin (Accounts requires it) and slot cookies', async () => {
  h.stub = switcherStub();
  const res = await worker.fetch(authed('/api/mail/accounts/switch', writeSwitch({ id: 'b' })), h.env);
  assert.equal(res.status, 200);

  const body = await res.json();
  assert.equal(body.activeId, 'b');
  assert.equal(body.authuser, 1);
  assert.equal(body.accounts.length, 2);
  assert.deepEqual(body.unread, { alice: 0, bob: 0 });

  const upstream = h.seen.find((s) => s.url.pathname === '/api/auth/switch');
  assert.ok(upstream, 'Accounts was called');
  assert.equal(upstream!.method, 'POST');
  assert.deepEqual(JSON.parse(upstream!.body!), { id: 'b' });
  assert.equal(upstream!.headers.get('cookie'), 'gothwad_at=good');
  assert.equal(upstream!.headers.get('origin'), MAIL_ORIGIN);

  // Every rotated cookie, as separate headers (never joined or overwritten).
  const cookies = res.headers.getSetCookie();
  assert.equal(cookies.length, 3);
  assert.ok(cookies.some((c) => c.startsWith('gothwad_active=b')));
  assert.ok(cookies.some((c) => c.startsWith('gothwad_sess_b=rotated')));
  assert.ok(cookies.some((c) => c.startsWith('gothwad_accounts=')));
});

test('accounts: switch accepts the Google authuser index', async () => {
  h.stub = switcherStub();
  const res = await worker.fetch(authed('/api/mail/accounts/switch', writeSwitch({ authuser: 1 })), h.env);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).authuser, 1);

  const upstream = h.seen.find((s) => s.url.pathname === '/api/auth/switch');
  assert.deepEqual(JSON.parse(upstream!.body!), { authuser: 1 });
});

test('accounts: switch rejects an unknown slot id without calling Accounts', async () => {
  h.stub = switcherStub();
  const res = await worker.fetch(authed('/api/mail/accounts/switch', writeSwitch({ id: '../x' })), h.env);
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
  assert.equal(h.seen.length, 0);
});

test('accounts: a revoked slot is a 409 with the re-auth link for that slot', async () => {
  h.stub = switcherStub({
    switchRes: () => Response.json({ error: 'account_not_signed_in' }, { status: 409 }),
  });
  const res = await worker.fetch(authed('/api/mail/accounts/switch', writeSwitch({ authuser: 2 })), h.env);
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.equal(body.error, 'account_not_signed_in');
  assert.match(body.reauthUrl, /\/signin\?login=1&authuser=2&next=/);
});

test('accounts: signing one account out promotes the other, not sign-out-all', async () => {
  h.stub = switcherStub();
  const res = await worker.fetch(authed('/api/mail/accounts/signout', writeSwitch({ id: 'b' })), h.env);
  assert.equal(res.status, 200);
  const body = await res.json();

  assert.equal(body.signedOutAll, false);
  assert.equal(body.activeId, 'a');
  assert.deepEqual(
    body.accounts.map((a: { id: string }) => a.id),
    ['a']
  );
  assert.ok(
    h.seen.some((s) => s.url.pathname === '/api/auth/accounts/b/signout'),
    'the per-account endpoint was called'
  );
});

test('accounts: signing out the last account reports signedOutAll', async () => {
  h.stub = switcherStub({
    accounts: [SLOT_A],
    signoutRes: () =>
      Response.json({ ok: true, signedOutAll: true, activeId: null, authuser: null, accounts: [] }),
  });
  const res = await worker.fetch(authed('/api/mail/accounts/signout', writeSwitch({ id: 'a' })), h.env);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.signedOutAll, true);
  assert.deepEqual(body.accounts, []);
});

test('accounts: "add another account" carries authuser + next for the new slot', async () => {
  h.stub = fullStub;
  const res = await worker.fetch(
    req('/api/mail/accounts/add', { cookie: 'gothwad_at=good', headers: { 'X-Gothwad-Authuser': '1' } }),
    h.env
  );
  assert.equal(res.status, 302);
  const location = new URL(res.headers.get('location')!);
  assert.equal(location.origin, 'https://accounts.test');
  assert.equal(location.pathname, '/signin');
  assert.equal(location.searchParams.get('add'), '1');
  assert.equal(location.searchParams.get('login'), '1');
  assert.equal(location.searchParams.get('authuser'), '2');
  assert.equal(location.searchParams.get('next'), 'https://mail.test/u/2/');
});

function writeSwitch(body: unknown): RequestInit {
  return {
    method: 'POST',
    origin: MAIL_ORIGIN,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

test('accounts keep Accounts\' own numbering, even when the array is shuffled', async () => {
  // /u/1/ is "the account Accounts calls 1". If the upstream array arrives in a
  // different order, Mail sorts it, so the tab URL and the switcher agree.
  h.stub = (s) => {
    if (s.url.pathname === '/api/auth/accounts') {
      return Response.json({
        activeId: 'b',
        authuser: 1,
        accounts: [
          { id: 'b', authuser: 1, username: 'bob', firstName: 'Bob', lastName: 'Verma' },
          { id: 'a', authuser: 0, username: 'alice', firstName: 'Alice', lastName: 'Sharma' },
        ],
      });
    }
    return new Response('x', { status: 599 });
  };

  const res = await worker.fetch(authed('/api/mail/accounts', { headers: { 'X-Gothwad-Authuser': '1' } }), h.env);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(
    body.accounts.map((a: { username: string; authuser: number }) => [a.username, a.authuser]),
    [
      ['alice', 0],
      ['bob', 1],
    ]
  );
  assert.equal(body.activeId, 'b', 'this tab is /u/1/, which is bob');
  assert.equal(body.authuser, 1);
});

test('POST /api/mail/accounts/signout-all revokes every slot', async () => {
  const seen: string[] = [];
  h.stub = (s) => {
    if (s.url.pathname === '/api/auth/signout') {
      seen.push(String(s.headers.get('x-gothwad-authuser')));
      return Response.json({ ok: true });
    }
    return new Response('x', { status: 599 });
  };

  const res = await worker.fetch(
    req('/api/mail/accounts/signout-all', {
      method: 'POST',
      cookie: 'gothwad_at=good',
      origin: MAIL_ORIGIN,
      headers: { 'X-Gothwad-Authuser': '1', 'content-type': 'application/json' },
      body: '{}',
    }),
    h.env
  );
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, signedOutAll: true });
  assert.deepEqual(seen, ['1'], 'the tab selector is forwarded like every other call');
});

test('signout-all needs a same-origin write, like the other account routes', async () => {
  h.stub = () => Response.json({ ok: true });
  const res = await worker.fetch(
    req('/api/mail/accounts/signout-all', {
      method: 'POST',
      cookie: 'gothwad_at=good',
      origin: 'https://evil.test',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    }),
    h.env
  );
  assert.equal(res.status, 403);
});
