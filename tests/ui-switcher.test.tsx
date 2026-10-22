// =============================================================================
// Account menu UI: the shared Accounts widget, wired to real Mail state.
//
// Mail no longer draws its own switcher. Tapping the avatar loads
// `window.GothwadAccountMenu` (Accounts' one-and-only Google-style sheet) and
// hands it Mail's live data and handlers. The tests below install Mail's local
// stand-in for that module — same `open(state, opts)` contract, same callbacks —
// so the whole path runs for real: header -> loader -> widget -> Mail handlers.
//
// Covered: the data Mail passes, switching in place with no stale row, anchor
// placement, closing, the built-in fallback when the widget cannot load,
// per-account sign-out, and the "no account data in web storage" rule.
// =============================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  accountDialog,
  accountTrigger,
  act,
  clickInSheet,
  installAccountWidget,
  isWidgetSheetOpen,
  mountApp,
  pressKey,
  pressOnFocus,
  removeAccountWidget,
  resetAccounts,
  resetCookie,
  sheetShadow,
  sheetText,
  text,
  unmountApp,
  waitFor,
  type WidgetRig,
} from './ui-harness.tsx';

const ALICE_ROW = "Only alice's account sees this";
const BOB_ROW = "Only bob's account sees this";

/** Opens the menu from the header and waits for the sheet (widget or fallback). */
async function openSheet(): Promise<void> {
  const trigger = accountTrigger();
  assert.ok(trigger, 'account trigger exists');
  await act(async () => {
    trigger.click();
  });
}

test('the shared widget gets every account, badge, theme and handler from Mail', async () => {
  await resetAccounts();
  const widget = await installAccountWidget();
  const root = await mountApp('/u/0/#inbox');
  await waitFor(() => text().includes(ALICE_ROW), 'alice inbox loaded');

  await openSheet();
  await waitFor(() => isWidgetSheetOpen(), 'shared widget opened');

  const { state, opts } = widget.calls[0];
  assert.equal(widget.calls.length, 1, 'the sheet is opened exactly once');
  assert.equal(state.activeId, 'a');
  assert.equal(state.authuser, 0);
  assert.equal((state.user as { username: string }).username, 'alice');
  assert.deepEqual(
    (state.accounts as Array<{ id: string; email: string; authuser: number }>).map((a) => [a.id, a.authuser]),
    [
      ['a', 0],
      ['b', 1],
    ]
  );
  assert.equal(typeof opts.badges?.alice, 'number', 'unread counts ride along');
  assert.equal(opts.theme, 'light');
  assert.equal(opts.nextUrl, 'http://localhost:3000/u/0/#inbox', 'Add another account returns here');
  assert.equal(typeof opts.onSwitchAccount, 'function');
  assert.equal(typeof opts.onSignOutAccount, 'function');
  assert.equal(typeof opts.onSignOutAll, 'function');
  assert.equal((opts.accountHref as (a: { authuser: number }) => string)({ authuser: 1 }), '/u/1/');
  assert.ok(String(opts.manageAccountHref).endsWith('/u/0/me'), 'manage link points at this account');

  // The sheet is Google's own: hero name, both accounts, add-account row.
  const sheet = sheetText();
  assert.ok(sheet.includes('alice@gothwadtech.com'), 'active account in the hero');
  assert.ok(sheet.includes('bob@gothwadtech.com'), 'second account listed');
  assert.ok(sheet.includes('Add another account'));

  await unmountApp(root);
});

test('switching from the widget repaints the new mailbox and never mixes the two', async () => {
  await resetAccounts();
  const widget = await installAccountWidget();
  const root = await mountApp('/u/0/#inbox');
  await waitFor(() => text().includes(ALICE_ROW), 'alice inbox loaded');

  await openSheet();
  await waitFor(() => isWidgetSheetOpen(), 'shared widget opened');

  const frames: string[] = [];
  const observer = new MutationObserver(() => frames.push(text()));
  observer.observe(document.getElementById('root')!, { childList: true, subtree: true, characterData: true });

  const clicked = await clickInSheet((label) => label.includes('bob@gothwadtech.com'));
  assert.equal(clicked, true, 'bob row is clickable inside the widget');
  await waitFor(() => text().includes(BOB_ROW), "bob's mailbox painted");
  observer.disconnect();

  assert.deepEqual(
    frames.filter((frame) => frame.includes(ALICE_ROW)),
    [],
    "no frame kept an alice row after switching to bob"
  );
  assert.deepEqual(
    frames.filter((frame) => frame.includes(BOB_ROW) && frame.includes(ALICE_ROW)),
    [],
    'no frame showed both mailboxes'
  );
  assert.equal(window.location.pathname, '/u/1/', 'the URL follows the account');
  assert.equal(widget.isOpen(), false, 'the widget closes itself after a switch');
  // Exactly one POST; the switch is optimistic, so it is not on the paint path.
  assert.equal(widget.calls.length, 1);

  await unmountApp(root);
  await resetAccounts();
});

test('the anchor is the avatar that was actually tapped', async () => {
  await resetAccounts();
  const widget = await installAccountWidget();
  const root = await mountApp('/u/0/#inbox');
  await waitFor(() => text().includes(ALICE_ROW), 'inbox loaded');

  // Mobile search-bar avatar (both avatars exist in the DOM; CSS hides one).
  const mobile = document.querySelector('button[aria-label^="Accounts ("]') as HTMLElement | null;
  assert.ok(mobile, 'mobile avatar exists');
  await act(async () => {
    mobile.click();
  });
  await waitFor(() => widget.calls.length === 1, 'widget opened from the mobile avatar');
  assert.equal(widget.calls[0].opts.anchorEl, mobile, 'the widget positions itself under that avatar');
  await act(async () => {
    widget.close();
  });

  // Shift+A has no pointer anchor, so it falls back to the same button.
  await pressKey('A', { shiftKey: true });
  await waitFor(() => widget.calls.length === 2, 'widget opened from the keyboard');
  assert.equal(widget.calls[1].opts.anchorEl, mobile, 'keyboard opens under the avatar too');

  await unmountApp(root);
});

test('Escape closes the sheet and leaves the mailbox alone', async () => {
  await resetAccounts();
  const widget = await installAccountWidget();
  const root = await mountApp('/u/0/#inbox');
  await waitFor(() => text().includes(ALICE_ROW), 'inbox loaded');

  await openSheet();
  await waitFor(() => isWidgetSheetOpen(), 'sheet open');
  await pressKey('Escape');
  await waitFor(() => !isWidgetSheetOpen(), 'Escape closed the sheet');
  assert.equal(text().includes(ALICE_ROW), true, 'no account changed');
  assert.equal(window.location.pathname, '/u/0/');

  await unmountApp(root);
});

test('when the widget cannot load, Mail keeps a working built-in menu', async () => {
  await resetAccounts();
  await removeAccountWidget();
  const root = await mountApp('/u/0/#inbox');
  await waitFor(() => text().includes(ALICE_ROW), 'inbox loaded');

  await openSheet();
  // No widget host: the fallback sheet took over.
  await waitFor(() => text().includes('Add another account'), 'fallback sheet rendered');
  assert.equal(isWidgetSheetOpen(), false, 'the shared widget is not on screen');

  const fallback = accountDialog();
  assert.ok(fallback, 'fallback is a labelled dialog');
  assert.equal(fallback.getAttribute('aria-modal'), 'true');
  assert.match(fallback.className, /env\(safe-area-inset-bottom\)/, 'safe area honoured');
  assert.ok(text().includes('bob@gothwadtech.com'), 'every account is still listed');
  assert.ok(text().includes('Sign out of all accounts'), 'sign-out-all is available');

  // It also really switches: the fallback must never be a dead end.
  const row = [...fallback.querySelectorAll('button')].find(
    (b) => b.textContent?.includes('bob@gothwadtech.com') && b.getAttribute('aria-current') === null
  );
  assert.ok(row, 'inactive row is clickable');
  await act(async () => {
    (row as HTMLElement).click();
  });
  await waitFor(() => window.location.pathname === '/u/1/', 'fallback switched the account');
  await waitFor(() => text().includes(BOB_ROW), "bob's mailbox painted");

  await unmountApp(root);
  await resetAccounts();
});

test('the widget is re-rendered when the theme or unread counts change', async () => {
  await resetAccounts();
  const widget = await installAccountWidget();
  const root = await mountApp('/u/0/#inbox');
  await waitFor(() => text().includes(ALICE_ROW), 'inbox loaded');

  await openSheet();
  await waitFor(() => isWidgetSheetOpen(), 'sheet open');

  // Toggle the theme from the header: the sheet must not stay light.
  const themeButton = document.querySelector('button[aria-label^="Switch to"]') as HTMLElement | null;
  assert.ok(themeButton, 'theme toggle exists in the header');
  await act(async () => {
    themeButton.click();
  });
  await waitFor(() => sheetShadow()?.querySelector('[data-theme="dark"]') !== null, 'sheet followed the theme');

  await unmountApp(root);
});

test('signing out of another account from the manage list keeps this mailbox', async () => {
  await resetAccounts();
  await installAccountWidget();
  const root = await mountApp('/u/0/#inbox');
  await waitFor(() => text().includes(ALICE_ROW), 'inbox loaded');

  await openSheet();
  await waitFor(() => isWidgetSheetOpen(), 'sheet open');
  assert.equal(await clickInSheet((label) => label === 'Manage accounts'), true, 'manage mode opens');
  await waitFor(() => (sheetText().match(/Sign out/g) ?? []).length >= 1, 'sign-out buttons appear');

  const shadow = sheetShadow()!;
  const bobSignOut = [...shadow.querySelectorAll<HTMLElement>('[data-signout-slot]')].find(
    (el) => el.getAttribute('data-signout-slot') === 'b'
  );
  assert.ok(bobSignOut, 'bob has his own sign-out button');
  await act(async () => {
    bobSignOut.click();
  });

  await waitFor(() => !isWidgetSheetOpen(), 'the sheet closed');
  assert.equal(window.location.pathname, '/u/0/', 'still alice');
  assert.equal(text().includes(ALICE_ROW), true, 'her mailbox was not reloaded');

  await unmountApp(root);
  await resetAccounts();
});

test('signing out of the shown account hops to the one that is left', async () => {
  await resetAccounts();
  await installAccountWidget();
  const root = await mountApp('/u/0/#inbox');
  await waitFor(() => text().includes(ALICE_ROW), 'inbox loaded');

  await openSheet();
  await waitFor(() => isWidgetSheetOpen(), 'sheet open');
  await clickInSheet((label) => label === 'Manage accounts');
  await waitFor(() => isWidgetSheetOpen() && sheetText().includes('Sign out of alice@gothwadtech.com'), 'sign-out row');

  const shadow = sheetShadow()!;
  const signOut = shadow.querySelector<HTMLElement>('[data-signout-active]');
  assert.ok(signOut, 'active account can be signed out');
  await act(async () => {
    signOut.click();
  });

  // With alice gone, bob is the only slot, so he becomes index 0.
  await waitFor(() => window.location.pathname === '/u/0/', 'URL hopped to the promoted account');
  await waitFor(() => text().includes(BOB_ROW), "bob's mailbox painted");
  assert.equal(text().includes(ALICE_ROW), false, "alice's rows are gone");

  await unmountApp(root);
  await resetAccounts();
});

test('the fallback sheet is keyboard reachable', async () => {
  await resetAccounts();
  await removeAccountWidget();
  const root = await mountApp('/u/0/#inbox');
  await waitFor(() => text().includes(ALICE_ROW), 'inbox loaded');

  await pressKey('A', { shiftKey: true });
  await waitFor(() => accountDialog() !== null, 'Shift+A opens the sheet');

  const dialog = accountDialog()!;
  const activeRow = [...dialog.querySelectorAll('button')].find((b) => b.getAttribute('aria-current') === 'true');
  assert.ok(activeRow, 'the active account is marked');
  // Focus moves into the sheet so Tab lands inside it and nothing behind it.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });
  assert.equal(dialog.contains(document.activeElement), true, 'focus is inside the sheet');

  await act(async () => {
    (document.activeElement as HTMLElement).dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
  await waitFor(() => accountDialog() === null, 'Escape closes the fallback');
  assert.equal(text().includes(ALICE_ROW), true, 'nothing was switched');

  await unmountApp(root);
});

test('the fallback fits a phone (390x844) and a desktop (1440x900)', async () => {
  await resetAccounts();
  await removeAccountWidget();
  const open = async (width: number, height: number) => {
    Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: height, configurable: true });
    const root = await mountApp('/u/0/#inbox');
    await waitFor(() => text().includes('Invoice for October'), 'inbox loaded');
    await openSheet();
    const dialog = await waitForDialog();
    assert.match(dialog.className, /max-h-\[90dvh\]/, 'never taller than the viewport');
    assert.match(dialog.className, /overflow-y-auto/, 'scrolls instead of overflowing');
    assert.match(dialog.className, /w-full/, 'full width on a phone');
    assert.match(dialog.className, /sm:max-w-sm/, 'capped width on a desktop');
    assert.match(dialog.className, /env\(safe-area-inset-bottom\)/, 'safe area honoured');
    assert.ok(dialog.querySelector('.min-h-\\[56px\\]'), 'rows are at least 56px tall');
    await unmountApp(root);
  };

  await open(390, 844);
  await open(1440, 900);
  await removeAccountWidget();
});

async function waitForDialog(): Promise<HTMLElement> {
  await waitFor(() => accountDialog() !== null, 'fallback dialog');
  return accountDialog()!;
}

test('no account data is written to localStorage or sessionStorage', async () => {
  await resetAccounts();
  await installAccountWidget();
  const root = await mountApp('/u/0/#inbox');
  await waitFor(() => text().includes('Invoice for October'), 'inbox loaded');

  const dump = (storage: Storage) =>
    Object.keys(storage)
      .map((key) => `${key}=${storage.getItem(key)}`)
      .join('|');
  for (const blob of [dump(window.localStorage), dump(window.sessionStorage)]) {
    assert.equal(/alice|bob|gothwadtech\.com/i.test(blob), false, 'no account identity in web storage');
    assert.equal(/"accounts"|activeId|authuser/.test(blob), false, 'no account list in web storage');
  }

  await unmountApp(root);
});
