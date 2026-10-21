// Multi-tab account isolation + single-call boot.
//
// Two browser tabs share ONE cookie jar. Each tab still has to read and write
// its own mailbox, because every request carries that tab's
// X-Gothwad-Authuser and the Worker forwards it to Accounts. These tests run the
// two tabs concurrently and prove nothing leaks between them.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.ts';
import { Db } from '../src/db.ts';
import { h, MAIL_ORIGIN, authed, req, seedMessage, makeEnv, type Stub } from './helpers.ts';

const SLOTS = [
  { id: 'a', authuser: 0, username: 'alice', firstName: 'Alice', lastName: 'Sharma' },
  { id: 'b', authuser: 1, username: 'bob', firstName: 'Bob', lastName: 'Verma' },
];

/** Accounts v2.3: `/auth/me` honours the tab selector and returns the list. */
function multiAccountStub(): Stub {
  return (s) => {
    if (s.url.host !== 'accounts.test') {
      if (s.url.host === 'api.resend.com') return Response.json({ id: 're_multitab' });
      return new Response('x', { status: 599 });
    }
    if (s.url.pathname === '/api/auth/me') {
      const selector = (s.headers.get('x-gothwad-authuser') || '').toLowerCase();
      const slot =
        SLOTS.find((a) => String(a.authuser) === selector) ??
        SLOTS.find((a) => a.id === selector) ??
        SLOTS.find((a) => a.username === selector) ??
        SLOTS[0];
      return Response.json({
        authenticated: true,
        user: { username: slot.username, first_name: slot.firstName, last_name: slot.lastName },
        activeId: slot.id,
        authuser: slot.authuser,
        accounts: SLOTS.map((a) => ({
          id: a.id,
          authuser: a.authuser,
          username: a.username,
          firstName: a.firstName,
          lastName: a.lastName,
        })),
      });
    }
    return new Response('x', { status: 599 });
  };
}

/** A request from tab N: its own selector, the shared cookie jar. */
function tab(tabIndex: number, path: string, init: RequestInit = {}) {
  return req(path, {
    ...init,
    cookie: 'gothwad_at=good',
    headers: { ...(init.headers as Record<string, string> | undefined), 'X-Gothwad-Authuser': String(tabIndex) },
  });
}

test('/api/session is a single-call boot: user + authuser + accounts + unread', async () => {
  h.stub = multiAccountStub();
  await seedMessage({ username: 'alice' });
  await seedMessage({ username: 'bob' });
  await seedMessage({ username: 'bob' });

  const res = await worker.fetch(tab(1, '/api/session'), h.env);
  assert.equal(res.status, 200);
  const body = await res.json();

  // Tab 1 is bob, even though nothing changed the browser-wide active cookie.
  assert.equal(body.user.username, 'bob');
  assert.equal(body.authuser, 1);
  assert.equal(body.activeId, 'b');
  assert.equal(body.accounts.length, 2);
  assert.deepEqual(body.unread, { alice: 1, bob: 2 });
  assert.equal(body.accountUrl, 'https://accounts.test/u/1/me');

  // Exactly one upstream call: no boot waterfall.
  const upstream = h.seen.filter((s) => s.url.host === 'accounts.test');
  assert.equal(upstream.length, 1);
  assert.equal(upstream[0].headers.get('x-gothwad-authuser'), '1');
});

test('two tabs read their own inbox concurrently without leakage', async () => {
  h.stub = multiAccountStub();
  await seedMessage({ username: 'alice', subject: 'For Alice only' });
  await seedMessage({ username: 'bob', subject: 'For Bob only' });

  const [aliceRes, bobRes] = await Promise.all([
    worker.fetch(tab(0, '/api/mail/messages?folder=inbox'), h.env),
    worker.fetch(tab(1, '/api/mail/messages?folder=inbox'), h.env),
  ]);
  const alice = await aliceRes.json();
  const bob = await bobRes.json();

  assert.deepEqual(
    alice.messages.map((m: { subject: string }) => m.subject),
    ['For Alice only']
  );
  assert.deepEqual(
    bob.messages.map((m: { subject: string }) => m.subject),
    ['For Bob only']
  );
});

test('a tab cannot read another tab account message by id', async () => {
  h.stub = multiAccountStub();
  const bobsId = await seedMessage({ username: 'bob', subject: 'Bob private' });

  const res = await worker.fetch(tab(0, `/api/mail/messages/${bobsId}`), h.env);
  assert.equal(res.status, 404, 'alice\'s tab must not open bob\'s message');
});

test('sending from tab B uses bob as the From, and stores it under bob', async () => {
  h.stub = multiAccountStub();

  const res = await worker.fetch(
    tab(1, '/api/mail/send', {
      method: 'POST',
      origin: MAIL_ORIGIN,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ to: ['friend@example.org'], subject: 'From bob', body: 'Hello' }),
    }),
    h.env
  );
  assert.equal(res.status, 201);
  assert.equal((await res.json()).sent, true);

  const db = await Db.from(h.env);
  const row = await db.first<{ to_username: string; from_email: string }>(
    "SELECT to_username, from_email FROM mail_messages WHERE folder = 'sent' ORDER BY received_at DESC LIMIT 1"
  );
  assert.equal(row?.to_username, 'bob');
  assert.equal(row?.from_email, 'bob@gothwadtech.com');

  // The send went out under the account the tab selected, not the other one.
  const resend = h.seen.find((s) => s.url.host === 'api.resend.com');
  assert.match(String(resend?.body), /bob@gothwadtech\.com/);
});

test('the ?authuser= query works for a first hard navigation (no header yet)', async () => {
  h.stub = multiAccountStub();
  const res = await worker.fetch(authed('/api/session?authuser=1'), h.env);
  const body = await res.json();
  assert.equal(body.user.username, 'bob');
  assert.equal(body.authuser, 1);
  const upstream = h.seen.find((s) => s.url.host === 'accounts.test');
  assert.equal(upstream?.headers.get('x-gothwad-authuser'), '1');
});

test('an out-of-range selector is ignored instead of being forwarded', async () => {
  h.stub = multiAccountStub();
  await worker.fetch(
    req('/api/session', { cookie: 'gothwad_at=good', headers: { 'X-Gothwad-Authuser': '9' } }),
    h.env
  );
  const upstream = h.seen.find((s) => s.url.host === 'accounts.test');
  assert.equal(upstream?.headers.get('x-gothwad-authuser'), null);
});

test('bearer sessions still work, with no account list', async () => {
  h.stub = (s) => {
    if (s.url.pathname === '/api/oauth/userinfo') {
      return Response.json({ sub: '1', preferred_username: 'alice', name: 'Alice' });
    }
    return new Response('x', { status: 599 });
  };
  const res = await worker.fetch(req('/api/session', { headers: { authorization: 'Bearer goodtoken' } }), h.env);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.authuser, 0);
  assert.deepEqual(body.accounts, []);
  assert.equal(body.accountUrl, 'https://accounts.test/me');
});

test('a dev session keeps the switcher off instead of crashing', async () => {
  h.stub = () => new Response('x', { status: 599 });
  const dev = makeEnv({ ENVIRONMENT: 'development', DEV_AUTH_USERNAME: 'pawan' });
  const res = await worker.fetch(req('/api/session'), dev);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.user.username, 'pawan');
  assert.deepEqual(body.accounts, []);
  assert.equal(h.seen.length, 0, 'dev sessions must not call Accounts');
});
