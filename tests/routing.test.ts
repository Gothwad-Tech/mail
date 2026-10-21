// Gmail-style URL routing: /u/0/, /u/1/, /mail/u/1/, ?authuser=1, ?u=1.
//
// These are the rules that make a deep link, a refresh and Back/Forward all
// land on the same account and folder. The module reads `window.location` at
// call time, so one import serves every case below.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  authUserHeaders,
  authUserPath,
  currentAuthUser,
  folderFromHash,
  navigateToAccount,
  normalizeAuthUserUrl,
  writeFolderToUrl,
} from '../src/services/authuser.ts';

const setGlobal = (key: string, value: unknown) =>
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });

/** Points `window` at a specific URL and returns it. */
function at(url: string): JSDOM {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url });
  setGlobal('window', dom.window);
  setGlobal('document', dom.window.document);
  setGlobal('history', dom.window.history);
  return dom;
}

test('currentAuthUser reads /u/<n>/ from the path', () => {
  at('https://mail.test/u/1/#sent');
  assert.equal(currentAuthUser(), 1);
  assert.equal(folderFromHash(), 'sent');

  at('https://mail.test/u/0/');
  assert.equal(currentAuthUser(), 0);
  assert.equal(folderFromHash(), 'inbox', 'no hash means the inbox');
});

test('currentAuthUser accepts Gmail aliases and query params', () => {
  at('https://mail.test/mail/u/2/#starred');
  assert.equal(currentAuthUser(), 2);

  at('https://mail.test/?authuser=1');
  assert.equal(currentAuthUser(), 1);

  at('https://mail.test/?u=3');
  assert.equal(currentAuthUser(), 3);

  at('https://mail.test/?login=1&authuser=2');
  assert.equal(currentAuthUser(), 2);
});

test('an out-of-range or malformed index falls back to account 0', () => {
  at('https://mail.test/u/9/');
  assert.equal(currentAuthUser(), 0);
  at('https://mail.test/u/x/');
  assert.equal(currentAuthUser(), 0);
  at('https://mail.test/?authuser=abc');
  assert.equal(currentAuthUser(), 0);
});

test('normalizeAuthUserUrl rewrites every form to /u/<n>/#<folder>', () => {
  at('https://mail.test/?authuser=1&folder=starred');
  assert.equal(normalizeAuthUserUrl(), 1);
  assert.equal(window.location.pathname, '/u/1/');
  assert.equal(window.location.hash, '#starred');
  assert.equal(window.location.search, '', 'the shortcut params are consumed');

  at('https://mail.test/mail/u/1/#sent');
  assert.equal(normalizeAuthUserUrl(), 1);
  assert.equal(window.location.pathname, '/u/1/');
  assert.equal(window.location.hash, '#sent', 'the folder hash is kept');

  at('https://mail.test/?login=1&authuser=2');
  assert.equal(normalizeAuthUserUrl(), 2);
  assert.equal(window.location.href.endsWith('/u/2/#inbox'), true);
});

test('one-shot params survive canonicalisation', () => {
  at('https://mail.test/?authuser=1&compose=1');
  assert.equal(normalizeAuthUserUrl(), 1);
  assert.equal(window.location.pathname, '/u/1/');
  assert.equal(window.location.search, '?compose=1', 'the composer still opens');
  assert.equal(window.location.hash, '#inbox');

  at('https://mail.test/?__mail_auth_return=1');
  assert.equal(normalizeAuthUserUrl(), 0);
  assert.equal(window.location.search, '?__mail_auth_return=1', 'the SSO marker is not eaten');
});

test('canonical URLs are left exactly as they are', () => {
  at('https://mail.test/u/2/#sent');
  const before = window.location.href;
  assert.equal(normalizeAuthUserUrl(), 2);
  assert.equal(window.location.href, before, 'no history entry for an already-canonical URL');
});

test('the folder is written to the hash without leaving the account', () => {
  at('https://mail.test/u/1/#inbox');
  writeFolderToUrl('sent');
  assert.equal(window.location.pathname, '/u/1/');
  assert.equal(window.location.hash, '#sent');
  assert.equal(currentAuthUser(), 1, 'the account never changes on folder nav');
});

test('switching accounts pushes history so Back returns to the first one', () => {
  at('https://mail.test/u/0/#inbox');
  const before = window.history.length;
  navigateToAccount(1, 'inbox');
  assert.equal(window.location.pathname, '/u/1/');
  assert.equal(window.location.hash, '#inbox');
  assert.equal(window.history.length, before + 1);
  assert.deepEqual(window.history.state, { authuser: 1 });
});

test('authUserPath builds canonical paths and clamps the index', () => {
  assert.equal(authUserPath(0, 'inbox'), '/u/0/#inbox');
  assert.equal(authUserPath(2), '/u/2/');
  assert.equal(authUserPath(99, 'sent'), '/u/5/#sent');
  assert.deepEqual(authUserHeaders(3), { 'X-Gothwad-Authuser': '3' });
});

test('every mail API call carries this tab account header', async () => {
  at('https://mail.test/u/1/#inbox');
  const seen: Array<Record<string, string>> = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
    seen.push(init?.headers as Record<string, string>);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const { mailApi } = await import('../src/services/mailApi.ts');
    await mailApi.getSession();
    await mailApi.listMessages('inbox');
    await mailApi.switchAccount({ id: 'b' });
    assert.equal(seen.length, 3);
    for (const headers of seen) {
      assert.equal(headers['X-Gothwad-Authuser'], '1', 'each call names this tab account');
    }
  } finally {
    globalThis.fetch = realFetch;
  }
});
