// =============================================================================
// Startup: identity gates the app, metadata never does.
//
// The whole point of the session split is that unread badges and the send quota
// are decoration. These tests hold those two numbers hostage — slow, then
// failing, then answering for the wrong account — and check that the mailbox
// keeps working, that nothing shows a made-up number, and that a late answer can
// never repaint another account's strip.
//
// Only `/api/session/meta` is intercepted; identity, the mailbox, the switcher
// and the Worker all run for real against the local API.
// =============================================================================

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  accountTrigger,
  act,
  clickInSheet,
  installAccountWidget,
  isWidgetSheetOpen,
  mountApp,
  resetAccounts,
  setApiInterceptor,
  text,
  unmountApp,
  waitFor,
} from './ui-harness.tsx';

/** The full-screen gate the old startup showed while it waited for D1. */
const GATE = 'Loading your Gothwad Account';

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const metaBody = (authuser: number, sendRemainingToday: number) => ({
  authenticated: true,
  meta: true,
  authuser,
  unread: { alice: authuser === 0 ? 9 : 2, bob: 2 },
  limits: { dailySendLimit: 30, sendRemainingToday },
});

const authuserOf = (init?: RequestInit): number =>
  Number(new Headers(init?.headers).get('x-gothwad-authuser') ?? '-1');

const isMeta = (url: string): boolean => url.startsWith('/api/session/meta');

const quotaSkeleton = (): Element | null => document.querySelector('[data-testid="quota-skeleton"]');

const retryButton = (): HTMLButtonElement | undefined =>
  [...document.querySelectorAll('button')].find((b) => /Send limit unavailable/.test(b.textContent || ''));

beforeEach(async () => {
  await resetAccounts();
  setApiInterceptor(null);
});

afterEach(() => {
  setApiInterceptor(null);
});

test('the mailbox paints while the unread/quota strip is still loading', async () => {
  let releaseMeta!: () => void;
  const held = new Promise<void>((resolve) => {
    releaseMeta = resolve;
  });

  setApiInterceptor(async (url) => {
    if (!isMeta(url)) return null;
    await held;
    return json(metaBody(0, 11));
  });

  const root = await mountApp('/u/0/#inbox');

  // Identity alone is enough: the shell, its folder rail and Compose are here.
  await waitFor(() => text().includes('Compose'), 'shell painted from identity alone');
  assert.equal(text().includes(GATE), false, 'the full-screen startup gate is gone');
  assert.ok(quotaSkeleton(), 'the quota strip shows a skeleton, not a number');
  assert.equal(/sends left today/.test(text()), false, 'no invented quota while it loads');

  // Now the (slow) database answers: the strip fills in, the shell never moved.
  await act(async () => {
    releaseMeta();
    await new Promise((r) => setTimeout(r, 0));
  });
  await waitFor(() => text().includes('11 of 30 sends left today'), 'the real quota is painted');
  assert.equal(quotaSkeleton(), null, 'skeleton replaced by the number');

  await unmountApp(root);
});

test('a failed metadata call leaves the mailbox usable and offers a retry', async () => {
  setApiInterceptor((url) =>
    isMeta(url) ? Promise.resolve(json({ error: 'auth_unavailable', message: 'Accounts is unreachable.' }, 503)) : null
  );

  const root = await mountApp('/u/0/#inbox');

  await waitFor(() => text().includes('Compose'), 'shell painted from identity alone');
  await waitFor(() => Boolean(retryButton()), 'the strip offers a retry instead of a number');
  assert.equal(text().includes(GATE), false, 'a broken database cannot gate the app');
  // The mailbox itself is served by the same database but is a separate request;
  // the list must still arrive (or show its own retry), never a blank gate.
  await waitFor(
    () => text().includes("Only alice's account sees this") || text().includes('Try again'),
    'the inbox request ran independently of the metadata call'
  );

  // Retrying the strip alone must fetch the numbers, not reload the mailbox.
  setApiInterceptor(null);
  await act(async () => {
    retryButton()!.click();
  });
  await waitFor(() => /of 30 sends left today/.test(text()), 'quota appears after the retry');
  assert.equal(Boolean(retryButton()), false, 'the retry affordance is gone');

  await unmountApp(root);
});

test('a late answer for the previous account can never paint the new one', async () => {
  const widget = await installAccountWidget();
  const heldAlice: Array<(body: unknown) => void> = [];

  setApiInterceptor((url, init) => {
    if (!isMeta(url)) return null;
    const authuser = authuserOf(init);
    if (authuser === 1) return Promise.resolve(json(metaBody(1, 12)));
    // Account 0 (alice) stays in the air until the test decides otherwise.
    return new Promise<Response>((resolve) => heldAlice.push((body) => resolve(json(body))));
  });

  const root = await mountApp('/u/0/#inbox');
  await waitFor(() => text().includes('Compose'), 'alice shell painted');
  await waitFor(() => heldAlice.length > 0, 'alice metadata request is pending');

  // Switch to bob through the real switcher path (draft flush -> URL -> paint).
  await act(async () => {
    accountTrigger()!.click();
  });
  await waitFor(() => isWidgetSheetOpen(), 'the shared widget opened');
  assert.equal(await clickInSheet((label) => label.includes('bob@gothwadtech.com')), true, 'bob is selectable');
  await waitFor(() => window.location.pathname === '/u/1/', 'the tab moved to bob');
  await waitFor(() => text().includes('12 of 30 sends left today'), "bob's quota is painted");
  assert.equal(widget.isOpen(), false);

  // Alice's answer finally arrives. It belongs to the account that is gone.
  await act(async () => {
    for (const resolve of heldAlice) resolve(metaBody(0, 3));
    await new Promise((r) => setTimeout(r, 120));
  });
  assert.equal(text().includes('3 of 30'), false, "alice's late quota did not repaint bob's strip");
  assert.ok(text().includes('12 of 30 sends left today'), "bob's numbers are still the ones on screen");

  await unmountApp(root);
  await resetAccounts();
});
