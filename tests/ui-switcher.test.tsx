// =============================================================================
// Account switcher UI: list, in-place switch, paint order, keyboard, viewport,
// and the rule that account identity never reaches web storage.
//
// Same harness as ui-smoke: the real <App /> against the running Worker
// (npm run worker:dev), which uses the local Accounts stub (alice a/0, bob b/1).
// =============================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  accountDialog,
  accountTrigger,
  act,
  mountApp,
  pressKey,
  pressOnFocus,
  resetAccounts,
  text,
  unmountApp,
  waitFor,
} from './ui-harness.tsx';

test('the account switcher lists every signed-in account and switches in place', async () => {
  await resetAccounts();

  // 1. The list itself: both accounts, with the unread count from Mail's D1.
  const accounts = (await (await fetch('/api/mail/accounts')).json()) as {
    activeId: string;
    accounts: Array<{ id: string; email: string; username: string }>;
    unread: Record<string, number>;
  };
  assert.equal(accounts.accounts.length, 2, 'the local Accounts stub has two accounts');
  assert.equal(accounts.activeId, 'a');
  assert.equal(typeof accounts.unread.bob, 'number');

  const root = await mountApp();
  await waitFor(() => text().includes('Invoice for October'), 'alice inbox loaded');

  // 2. Open the switcher from the header avatar.
  const trigger = [...document.querySelectorAll('button')].find((b) =>
    /Accounts \(2\)|User profile|Account details/.test(b.getAttribute('aria-label') || '')
  );
  assert.ok(trigger, 'account trigger exists');
  await act(async () => {
    (trigger as HTMLElement).click();
  });
  await waitFor(() => text().includes('bob@gothwadtech.com'), 'second account row');
  assert.ok(text().includes('alice@gothwadtech.com'), 'active account row is listed');
  assert.ok(text().includes('Add another account'), 'add-account entry exists');
  assert.ok(text().includes('Gothwad Accounts'), 'sheet title reflects multiple accounts');

  // 3. Switch. The row that is not active is a button around the bob address.
  const row = [...document.querySelectorAll('button')].find(
    (b) => b.textContent?.includes('bob@gothwadtech.com') && b.getAttribute('aria-current') === null
  );
  assert.ok(row, 'inactive account row is clickable');
  await act(async () => {
    (row as HTMLElement).click();
  });

  // 4. The sheet closes only after the switch resolved (bob's row in the open
  //    sheet also contains his address, so wait for the close first).
  await waitFor(() => !text().includes('Add another account'), 'switcher closed after switching');

  // 5. The whole app is now bob: sidebar shows bob, the sheet is gone, and the
  //    mailbox reloaded for bob (not alice's cached list).
  await waitFor(() => text().includes('bob@gothwadtech.com'), 'app switched to bob');
  assert.equal(
    [...document.querySelectorAll('button')].some((b) => b.textContent?.includes('alice@gothwadtech.com')),
    false,
    'no alice row is left behind'
  );
  await waitFor(() => text().includes('Invoice for October'), 'bob inbox loaded');

  await unmountApp(root);
  await resetAccounts();
});

test('paint order: no row of the old account survives the switch to the new one', async () => {
  await resetAccounts();

  const root = await mountApp('/u/0/#inbox');
  const ALICE_ROW = "Only alice's account sees this";
  const BOB_ROW = "Only bob's account sees this";
  await waitFor(() => text().includes(ALICE_ROW), 'alice marker row');
  assert.equal(text().includes(BOB_ROW), false, "bob's mail is not readable from alice's tab");

  const trigger = accountTrigger();
  assert.ok(trigger, 'account trigger exists');
  await act(async () => {
    trigger.click();
  });
  await waitFor(() => text().includes('Add another account'), 'switcher open');

  const row = [...document.querySelectorAll('button')].find(
    (b) => b.textContent?.includes('bob@gothwadtech.com') && b.getAttribute('aria-current') === null
  );
  assert.ok(row, 'bob row is clickable');

  // Record every painted frame from the click onwards.
  const frames: string[] = [];
  const observer = new MutationObserver(() => frames.push(text()));
  observer.observe(document.getElementById('root')!, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  await act(async () => {
    (row as HTMLElement).click();
  });
  await waitFor(() => text().includes(BOB_ROW), "bob's marker row");
  observer.disconnect();

  assert.ok(frames.length > 0, 'the switch actually painted something');
  const polluted = frames.filter((frame) => frame.includes(BOB_ROW) && frame.includes(ALICE_ROW));
  assert.deepEqual(polluted, [], 'a frame painted bob together with an alice row');
  const aliceAfterSwitch = frames.filter((frame) => frame.includes(ALICE_ROW));
  assert.deepEqual(aliceAfterSwitch, [], "alice's rows never came back after switching to bob");

  // The URL is this tab's account, and the mailbox belongs to it.
  assert.equal(window.location.pathname, '/u/1/');
  await waitFor(() => text().includes('bob@gothwadtech.com'), 'header shows bob');

  await unmountApp(root);
  await resetAccounts();
  window.history.replaceState(window.history.state, '', '/');
});

test('keyboard: Shift+A opens the switcher, arrows move, Esc closes', async () => {
  await resetAccounts();
  const root = await mountApp();
  await waitFor(() => text().includes("Only alice's account sees this"), 'alice inbox loaded');

  await pressKey('A', { shiftKey: true });
  await waitFor(() => text().includes('Add another account'), 'Shift+A opens the switcher');

  const dialog = accountDialog() as HTMLElement;
  assert.ok(dialog, 'the sheet is a labelled dialog');
  assert.equal(dialog.getAttribute('aria-modal'), 'true');

  // The active row has focus, ArrowDown moves to bob, and Enter activates him.
  const activeRow = [...dialog.querySelectorAll('button')].find((b) => b.getAttribute('aria-current') === 'true');
  assert.ok(activeRow, 'active row is marked');
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10)); // the focus timer in the sheet
  });
  assert.equal(document.activeElement, activeRow, 'focus starts on the active account');

  await pressOnFocus('ArrowDown');
  assert.ok(
    (document.activeElement as HTMLElement).textContent?.includes('bob@gothwadtech.com'),
    'ArrowDown moves focus to the next account'
  );

  await pressOnFocus('ArrowUp');
  assert.ok(
    (document.activeElement as HTMLElement).textContent?.includes('alice@gothwadtech.com'),
    'ArrowUp moves back, wrapping is not needed here'
  );

  await pressOnFocus('Escape');
  await waitFor(() => !text().includes('Add another account'), 'Esc closes the sheet');
  assert.equal(text().includes("Only alice's account sees this"), true, 'Esc does not switch or reload');

  await unmountApp(root);
});

test('the sheet fits a phone (390x844) and a desktop (1440x900)', async () => {
  await resetAccounts();
  const open = async (width: number, height: number) => {
    Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: height, configurable: true });
    const root = await mountApp();
    await waitFor(() => text().includes('Invoice for October'), 'inbox loaded');
    const trigger = accountTrigger();
    assert.ok(trigger, 'account trigger exists');
    await act(async () => {
      trigger.click();
    });
    const dialog = accountDialog() as HTMLElement;
    assert.ok(dialog, 'sheet open');
    const classes = dialog.className;
    assert.match(classes, /max-h-\[90dvh\]/, 'never taller than the viewport');
    assert.match(classes, /overflow-y-auto/, 'scrolls instead of overflowing');
    assert.match(classes, /w-full/, 'full width on a phone');
    assert.match(classes, /sm:max-w-md/, 'capped width on a desktop');
    assert.match(classes, /env\(safe-area-inset-bottom\)/, 'safe area honoured');
    // 44px tap targets: rows are min-h-[56px], action rows use p-3.
    assert.ok(dialog.querySelector('.min-h-\\[56px\\]'), 'account rows are at least 56px tall');

    await unmountApp(root);
  };

  await open(390, 844);
  await open(1440, 900);
});

test('no account data is written to localStorage or sessionStorage', async () => {
  await resetAccounts();
  const root = await mountApp();
  await waitFor(() => text().includes('Invoice for October'), 'inbox loaded');

  const dump = (storage: Storage) =>
    Object.keys(storage)
      .map((key) => `${key}=${storage.getItem(key)}`)
      .join('|');
  const local = dump(window.localStorage);
  const session = dump(window.sessionStorage);
  for (const blob of [local, session]) {
    assert.equal(/alice|bob|gothwadtech\.com/i.test(blob), false, 'no account identity in web storage');
    assert.equal(/"accounts"|activeId|authuser/.test(blob), false, 'no account list in web storage');
  }

  await unmountApp(root);
});

test('signing out the inactive account leaves the open mailbox untouched', async () => {
  await resetAccounts();
  const root = await mountApp('/u/0/#inbox');
  await waitFor(() => text().includes("Only alice's account sees this"), 'alice inbox loaded');

  const trigger = accountTrigger();
  assert.ok(trigger, 'account trigger exists');
  await act(async () => {
    trigger.click();
  });
  await waitFor(() => text().includes('bob@gothwadtech.com'), 'sheet lists bob');

  const signOutBob = document.querySelector('button[aria-label="Sign out of bob@gothwadtech.com"]');
  assert.ok(signOutBob, 'per-account sign-out button exists');
  await act(async () => {
    (signOutBob as HTMLElement).click();
  });

  await waitFor(() => !text().includes('bob@gothwadtech.com'), 'bob is gone from the switcher');
  // Still alice, still on /u/0/, and the same message list is on screen.
  assert.equal(window.location.pathname, '/u/0/');
  assert.equal(text().includes("Only alice's account sees this"), true, 'the open mailbox did not reload');
  assert.equal(text().includes('Add another account'), true, 'the sheet stays open while nobody is switched');

  await unmountApp(root);
  await resetAccounts();
});

test('signing out the account this tab shows hops to the other one', async () => {
  await resetAccounts();
  const root = await mountApp('/u/0/#inbox');
  await waitFor(() => text().includes("Only alice's account sees this"), 'alice inbox loaded');

  const trigger = accountTrigger();
  assert.ok(trigger, 'account trigger exists');
  await act(async () => {
    trigger.click();
  });
  await waitFor(() => text().includes('bob@gothwadtech.com'), 'sheet lists bob');

  const signOutAlice = document.querySelector('button[aria-label="Sign out of alice@gothwadtech.com"]');
  assert.ok(signOutAlice, 'per-account sign-out button exists');
  await act(async () => {
    (signOutAlice as HTMLElement).click();
  });

  // The promoted account is bob. With alice gone he is the only slot, so he is
  // index 0: the URL follows what the Worker returned, not a hard-coded 1.
  await waitFor(() => window.location.pathname === '/u/0/', 'URL hopped to the promoted account');
  await waitFor(() => text().includes("Only bob's account sees this"), "bob's mailbox painted");
  assert.equal(text().includes("Only alice's account sees this"), false, "alice's rows are gone");
  assert.equal(text().includes('bob@gothwadtech.com'), true);

  await unmountApp(root);
  await resetAccounts();
});
