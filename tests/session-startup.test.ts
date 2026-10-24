// =============================================================================
// Startup requests: shared, account-scoped and cancellable.
//
// These tests run the real services/sessionClient.ts against a fake fetch, so
// they pin the three properties the fast startup depends on:
//
//   1. two consumers of the same identity make ONE network call;
//   2. /u/0 and /u/1 never share a request or an answer;
//   3. when the last consumer goes away the request is aborted, and nothing is
//      cached afterwards (a later mount asks again — no stale signed-in view).
// =============================================================================

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { ApiError } from '../src/services/mailApi.ts';
import {
  pendingSessionRequests,
  requestIdentity,
  requestSessionMeta,
  resetSessionRequests,
} from '../src/services/sessionClient.ts';

interface Call {
  url: string;
  headers: Headers;
  signal: AbortSignal | undefined;
  reply: (body: unknown, status?: number) => void;
  failWithAbort: () => void;
}

const realFetch = globalThis.fetch;
let calls: Call[] = [];

/** Minimal `window`: only the URL fields the account selector reads. */
function setPath(pathname: string, search = ''): void {
  Object.defineProperty(globalThis, 'window', {
    value: { location: { pathname, search, hash: '' } },
    configurable: true,
    writable: true,
  });
}

const identityBody = (authuser: number) => ({
  authenticated: true,
  user: { username: authuser === 0 ? 'alice' : 'bob', email: 'x@gothwadtech.com', name: null },
  authuser,
  activeId: authuser === 0 ? 'a' : 'b',
  accounts: [],
  accountUrl: '',
  accountsWebOrigin: '',
  meta: false,
  unread: null,
  limits: null,
});

beforeEach(() => {
  calls = [];
  setPath('/u/0/');
  resetSessionRequests();
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    return new Promise<Response>((resolve, reject) => {
      const call: Call = {
        url: String(input),
        headers: new Headers(init?.headers),
        signal: init?.signal ?? undefined,
        reply: (body, status = 200) =>
          resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })),
        failWithAbort: () => reject(new DOMException('The operation was aborted.', 'AbortError')),
      };
      calls.push(call);
      init?.signal?.addEventListener('abort', call.failWithAbort);
    });
  }) as typeof fetch;
});

afterEach(() => {
  resetSessionRequests();
  globalThis.fetch = realFetch;
});

test('two consumers share one identity request', async () => {
  const first = requestIdentity();
  const second = requestIdentity();
  assert.equal(calls.length, 1, 'one Accounts verification, not two');
  assert.equal(pendingSessionRequests(), 1);

  calls[0].reply(identityBody(0));
  const [a, b] = await Promise.all([first.promise, second.promise]);
  assert.equal(a.user.username, 'alice');
  assert.equal(b.user.username, 'alice');
  assert.equal(pendingSessionRequests(), 0, 'settled requests leave no entry');

  first.release();
  second.release();
});

test('the identity request is identity-only and carries this tab account', async () => {
  const req = requestIdentity();
  assert.ok(calls[0].url.endsWith('/api/session?meta=0'), `identity path, got ${calls[0].url}`);
  assert.equal(calls[0].headers.get('x-gothwad-authuser'), '0');
  calls[0].reply(identityBody(0));
  await req.promise;
  req.release();

  setPath('/u/1/');
  const other = requestIdentity();
  assert.equal(calls[1].headers.get('x-gothwad-authuser'), '1', 'the selector travels with the request');
  calls[1].reply(identityBody(1));
  const info = await other.promise;
  assert.equal(info.authuser, 1, 'the answer belongs to the slot that asked');
  other.release();
});

test('requests and answers never cross account selectors', async () => {
  setPath('/u/0/');
  const alice = requestIdentity();
  setPath('/u/1/');
  const bob = requestIdentity();
  assert.equal(calls.length, 2, '/u/0 and /u/1 are separate requests');

  // Answer them out of order: bob first, then alice.
  calls[1].reply(identityBody(1));
  calls[0].reply(identityBody(0));
  assert.equal((await bob.promise).authuser, 1);
  assert.equal((await alice.promise).authuser, 0);
  alice.release();
  bob.release();
});

test('the last consumer leaving aborts the request instead of leaving it running', async () => {
  const first = requestIdentity();
  const second = requestIdentity();

  first.release();
  assert.equal(calls[0].signal?.aborted, false, 'still needed by the second consumer');

  second.release();
  assert.equal(calls[0].signal?.aborted, true, 'nobody is waiting: cancel the call');
  await assert.rejects(first.promise, (err: unknown) => err instanceof ApiError && err.status === 0);
  assert.equal(pendingSessionRequests(), 0);
});

test('nothing is cached after the answer: a remount asks again', async () => {
  const first = requestIdentity();
  calls[0].reply(identityBody(0));
  await first.promise;
  first.release();

  const again = requestIdentity();
  assert.equal(calls.length, 2, 'no long-lived authenticated payload in memory');
  calls[1].reply(identityBody(0));
  await again.promise;
  again.release();
});

test('the metadata request has its own key and its own account header', async () => {
  const identity = requestIdentity();
  calls[0].reply(identityBody(0));
  await identity.promise;
  identity.release();

  const meta = requestSessionMeta(1);
  assert.equal(calls[1].url, '/api/session/meta');
  assert.equal(calls[1].headers.get('x-gothwad-authuser'), '1');
  calls[1].reply({ authuser: 1, unread: { bob: 3 }, limits: { dailySendLimit: 30, sendRemainingToday: 7 } });
  const answer = await meta.promise;
  assert.deepEqual(answer.unread, { bob: 3 });
  assert.equal(answer.limits.sendRemainingToday, 7);
  meta.release();
});

test('a reset (sign-out) cancels everything in flight', async () => {
  const identity = requestIdentity();
  resetSessionRequests();
  assert.equal(calls[0].signal?.aborted, true);
  assert.equal(pendingSessionRequests(), 0);
  await assert.rejects(identity.promise, (err: unknown) => err instanceof ApiError);
});
