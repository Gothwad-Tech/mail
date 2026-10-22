// =============================================================================
// The account-menu contract, without a browser.
//
// Two things are tested here:
//   1. `buildAccountMenu` — the exact `(state, opts)` Mail hands to the shared
//      Accounts widget, including the URLs that make Ctrl/Cmd-click and
//      "Add another account" work.
//   2. The loader — one import no matter how many taps, a clear error instead of
//      a throw, and no second request once the module is cached.
//
// The widget is remote code owned by Accounts, so Mail must rely only on the
// documented surface: open / update / close / isOpen and the option names below.
// =============================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  accountHrefFor,
  buildAccountMenu,
  manageHrefFor,
  type BuildMenuArgs,
} from '../src/services/accountMenu.ts';
import {
  accountWidgetError,
  accountWidgetUrl,
  closeAccountWidget,
  isAccountWidgetOpen,
  loadAccountWidget,
  loadedAccountWidget,
  openAccountWidget,
  resetAccountWidgetForTests,
  setAccountWidgetForTests,
  updateAccountWidget,
} from '../src/services/accountWidget.ts';

const accounts = [
  {
    id: 'a',
    authuser: 0,
    username: 'alice',
    name: 'Alice Sharma',
    firstName: 'Alice',
    lastName: 'Sharma',
    email: 'alice@gothwadtech.com',
    avatarUrl: 'https://cdn.test/alice.png',
    accountUrl: 'https://accounts.test/u/0/me',
    lastUsedAt: null,
  },
  {
    id: 'b',
    authuser: 1,
    username: 'bob',
    name: 'Bob Verma',
    firstName: 'Bob',
    lastName: 'Verma',
    email: 'bob@gothwadtech.com',
    avatarUrl: null,
    accountUrl: 'https://accounts.test/u/1/me',
    lastUsedAt: null,
  },
];

function args(overrides: Partial<BuildMenuArgs> = {}): BuildMenuArgs {
  return {
    user: {
      username: 'alice',
      name: 'Alice Sharma',
      firstName: 'Alice',
      lastName: 'Sharma',
      email: 'alice@gothwadtech.com',
      avatarUrl: 'https://cdn.test/alice.png',
    },
    accounts,
    activeId: 'a',
    authuser: 0,
    theme: 'dark',
    unread: { alice: 3, bob: 12 },
    accountsWebOrigin: 'https://accounts.test/',
    accountUrl: 'https://accounts.test/u/0/me',
    href: 'https://mail.test/u/0/#inbox',
    anchorEl: null,
    handlers: {
      onSwitchAccount: () => undefined,
      onSignOutAccount: () => undefined,
      onSignOutAll: () => undefined,
      onError: () => undefined,
      onClose: () => undefined,
    },
    ...overrides,
  };
}

test('state carries the active user, every account and this tab index', () => {
  const { state } = buildAccountMenu(args());
  assert.deepEqual(state.activeId, 'a');
  assert.equal(state.authuser, 0);
  assert.equal((state.user as { avatarUrl: string }).avatarUrl, 'https://cdn.test/alice.png');
  const list = state.accounts as Array<{ id: string; avatarUrl: string | null }>;
  assert.equal(list.length, 2);
  assert.equal(list[1].avatarUrl, null, 'an account without a photo keeps null');
});

test('opts match the widget contract', () => {
  const { opts } = buildAccountMenu(args());
  assert.equal(opts.theme, 'dark', 'the sheet follows Mail in one click');
  assert.deepEqual(opts.badges, { alice: 3, bob: 12 }, 'unread pills come from Mail D1');
  assert.equal(opts.nextUrl, 'https://mail.test/u/0/#inbox');
  // Mail must not hijack "Manage your account": leaving onManageAccount unset
  // lets the widget's own link navigate (and middle-click opens a new tab).
  assert.equal('onManageAccount' in opts, false);
  assert.equal(opts.manageAccountHref, 'https://accounts.test/u/0/me');
  assert.equal(opts.accountsWebOrigin, 'https://accounts.test', 'trailing slash trimmed');
  assert.equal(opts.ecosystemName, 'Gothwad');
  assert.equal(typeof opts.onSwitchAccount, 'function');
});

test('account links are Google-style paths, so Ctrl/Cmd-click opens a new tab', () => {
  assert.equal(accountHrefFor({ authuser: 0 }), '/u/0/');
  assert.equal(accountHrefFor({ authuser: 2 }), '/u/2/');
  assert.equal(accountHrefFor({ authuser: 99 }), '/u/5/', 'clamped to the 6-slot maximum');
  assert.equal(manageHrefFor('https://accounts.test', 1), 'https://accounts.test/u/1/me');
  assert.equal(
    manageHrefFor('https://accounts.test', 1, 'https://accounts.test/u/1/me?from=mail'),
    'https://accounts.test/u/1/me?from=mail',
    'the Worker-provided URL wins'
  );
  // A missing origin must not produce a broken "//u/0/me".
  assert.equal(manageHrefFor('', 0), '');
});

test('extra actions become widget rows and run Mail handlers', () => {
  let ran = 0;
  const { opts } = buildAccountMenu(
    args({ extras: [{ label: 'Mail settings', onClick: () => (ran += 1) }] })
  );
  const extras = opts.extraActions as Array<{ label: string; onClick: () => void }>;
  assert.equal(extras.length, 1);
  extras[0].onClick();
  assert.equal(ran, 1);
});

test('the widget URL is built from the session origin, never hardcoded', () => {
  assert.equal(accountWidgetUrl('https://accounts.test'), 'https://accounts.test/widget/account-menu.js');
  assert.equal(accountWidgetUrl('https://accounts.test/'), 'https://accounts.test/widget/account-menu.js');
  assert.equal(accountWidgetUrl(''), '/widget/account-menu.js');
});

test('a widget on this host is fetched by path, not by absolute URL', () => {
  // Development serves the stand-in through the Vite proxy, so the import stays
  // same-origin there. A different host stays absolute (production).
  const before = (globalThis as { location?: unknown }).location;
  (globalThis as { location?: unknown }).location = { host: 'accounts.test' };
  try {
    assert.equal(accountWidgetUrl('https://accounts.test'), '/widget/account-menu.js');
    assert.equal(accountWidgetUrl('http://accounts.test'), '/widget/account-menu.js', 'any scheme, same host');
    assert.equal(
      accountWidgetUrl('https://accounts.other.test'),
      'https://accounts.other.test/widget/account-menu.js',
      'a different host stays absolute'
    );
  } finally {
    (globalThis as { location?: unknown }).location = before;
  }
});

test('a missing widget produces a result, not a thrown error', async () => {
  resetAccountWidgetForTests();
  const result = await openAccountWidget('', {}, {});
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, 'not_loaded');
    assert.ok(result.message.length > 0, 'the UI has something to log');
  }
  assert.ok(accountWidgetError(), 'the loader remembers why it failed');
});

test('open/update/close go to the loaded widget exactly once per tap', async () => {
  resetAccountWidgetForTests();
  const calls: string[] = [];
  setAccountWidgetForTests({
    open: () => calls.push('open'),
    update: () => calls.push('update'),
    close: () => calls.push('close'),
    isOpen: () => calls.includes('open') && !calls.includes('close'),
  });
  assert.equal(loadedAccountWidget() !== null, true);

  const result = await openAccountWidget('https://accounts.test', { a: 1 }, { b: 2 });
  assert.equal(result.ok, true);
  updateAccountWidget({ a: 2 }, { b: 3 });
  assert.equal(isAccountWidgetOpen(), true);
  closeAccountWidget();
  assert.equal(isAccountWidgetOpen(), false);
  assert.deepEqual(calls, ['open', 'update', 'close']);

  resetAccountWidgetForTests();
});

test('a cached module is never imported twice', async () => {
  resetAccountWidgetForTests();
  setAccountWidgetForTests({ open: () => undefined });
  const first = await loadAccountWidget('https://accounts.test');
  const second = await loadAccountWidget('https://accounts.test');
  assert.equal(first, second);
  assert.equal(first !== null, true);
  resetAccountWidgetForTests();
});
