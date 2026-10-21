// =============================================================================
// UI smoke test: renders the real <App /> in jsdom and talks to the Worker API.
//
// Needs the Worker running (npm run worker:dev) with a signed-in cookie
// session. The test sets the cookie itself. It is a smoke test, not a full
// browser test: it checks the auth gate, the mailbox list, opening a message
// (HTML goes into a sandboxed iframe), and the compose window.
//
// Run: npm run test:ui   (set MAIL_API_ORIGIN if the Worker is not on 127.0.0.1:8787)
// =============================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  act,
  mountApp,
  resetCookie,
  setCookie,
  text,
  unmountApp,
  waitFor,
} from './ui-harness.tsx';

const consoleErrors: string[] = [];
const originalError = console.error;
console.error = (...args: unknown[]) => {
  consoleErrors.push(args.map(String).join(' ').slice(0, 300));
};

test('signed-in user sees the inbox, can open a message safely, and can open compose', async () => {
  resetCookie();
  const root = await mountApp();

  // 1. Auth gate first, then the real list from the Worker.
  assert.match(text(), /Checking your Gothwad account/);
  await waitFor(() => text().includes('Invoice for October'), 'inbox row "Invoice for October"');
  assert.ok(text().includes('alice@gothwadtech.com') || text().includes('Inbox'), 'sidebar shows the Inbox');
  assert.equal(text().includes('Supabase'), false, 'no Supabase UI left');
  assert.equal(text().includes('John Demo'), false, 'no demo names');

  // 2. Open the message. The HTML body must sit in a sandboxed iframe.
  const row = [...document.querySelectorAll('div')].find((el) => el.textContent?.includes('Invoice for October') && el.classList.contains('cursor-pointer'));
  assert.ok(row, 'clickable message row exists');
  await act(async () => {
    (row as HTMLElement).click();
  });
  await waitFor(() => !!document.querySelector('iframe[title="Message body"]'), 'message body iframe');
  const iframe = document.querySelector('iframe[title="Message body"]') as HTMLIFrameElement;
  const sandbox = iframe.getAttribute('sandbox') || '';
  assert.ok(sandbox.length >= 0 && !sandbox.includes('allow-scripts'), 'iframe sandbox must not allow scripts');
  assert.ok(!sandbox.includes('allow-same-origin'), 'iframe must not be same-origin');
  assert.match(iframe.getAttribute('srcdoc') || '', /Content-Security-Policy/);

  // 3. Compose opens an empty window.
  const composeBtn = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Compose');
  assert.ok(composeBtn, 'Compose button exists');
  await act(async () => {
    composeBtn.click();
  });
  await waitFor(() => !!document.querySelector('textarea[placeholder="Compose email"]'), 'compose body textarea');

  await unmountApp(root);
  if (consoleErrors.length) {
    originalError(`[ui-smoke] ${consoleErrors.length} React console error(s):\n${consoleErrors.slice(0, 5).join('\n')}`);
  }
});

test('Settings shows the mailbox storage card and the retention selector works', async () => {
  resetCookie();
  const root = await mountApp();
  await waitFor(() => text().includes('Invoice for October'), 'inbox loaded');

  const settingsBtn = document.querySelector('button[aria-label="Settings"]') as HTMLButtonElement | null;
  assert.ok(settingsBtn, 'Settings button exists');
  await act(async () => {
    settingsBtn.click();
  });
  await waitFor(() => text().includes('Mailbox Storage & Email Retention'), 'storage card');

  // Live usage comes from GET /api/mail/settings (real SQLite behind the Worker).
  await waitFor(() => /Used .* of .* MB/.test(text()), 'storage usage line');
  assert.ok(text().includes('Latest 500 emails (Default)'), 'default retention option');
  assert.ok(text().includes('Store All Emails'), 'store all option');
  assert.ok(text().includes('Starred emails & Drafts are never auto-deleted'), 'safety badge');

  const option = [...document.querySelectorAll('[role="radio"]')].find((el) =>
    el.textContent?.includes('Latest 1,500 emails')
  ) as HTMLElement | undefined;
  assert.ok(option, 'retention option is clickable');
  await act(async () => {
    option.click();
  });
  await waitFor(() => option.getAttribute('aria-checked') === 'true', 'retention saved to the Worker');

  await unmountApp(root);
});

test('signed-out browser is sent to Accounts sign-in (with next=) and never sees mail', async () => {
  setCookie('unrelated=1');
  const root = await mountApp();
  await waitFor(() => text().includes('Redirecting you to sign in'), 'redirect message');
  assert.equal(text().includes('Invoice for October'), false, 'no mail is rendered before sign-in');
  await unmountApp(root);
});

test('failed Accounts return is explained instead of redirecting to the chooser forever', async () => {
  setCookie('unrelated=1');
  const root = await mountApp('/?__mail_auth_return=1');

  await waitFor(() => text().includes('Accounts sent you back to Mail'), 'SSO handoff error');
  assert.equal(text().includes('Redirecting you to sign in'), false, 'do not start another chooser round-trip');
  assert.equal(new URL(window.location.href).searchParams.has('__mail_auth_return'), false, 'one-time marker is cleaned');

  await unmountApp(root);
});

test('a 503 session check shows the profile error with Retry and does not redirect', async (t) => {
  // The Worker answers 503 accounts_user_invalid when Accounts says the user is
  // signed in but sends no usable username. The app must show that with a Retry
  // button instead of sending the browser back to the Accounts chooser.
  setCookie('gothwad_at=no_username');
  const probe = await fetch('/api/session');
  if (probe.status !== 503) {
    t.skip(
      `the local Accounts stub must answer 200 {authenticated:true,user:{username:""}} for ` +
        `cookie gothwad_at=no_username; the Worker answered ${probe.status}`
    );
    resetCookie();
    return;
  }
  assert.equal(((await probe.json()) as { error: string }).error, 'accounts_user_invalid');

  const before = window.location.href;
  const root = await mountApp();

  await waitFor(() => text().includes('could not load your profile'), 'profile error message');
  assert.equal(text().includes('Redirecting you to sign in'), false, 'a 503 must not redirect');
  assert.equal(text().includes('cookie'), false, 'no expired-cookie wording for a 503');
  assert.ok(
    [...document.querySelectorAll('button')].some((b) => b.textContent?.trim() === 'Try again'),
    'Retry button is shown'
  );
  // The app canonicalises `/` to `/u/0/#inbox` on boot; the point is that it
  // never leaves the app's own origin for the Accounts host.
  assert.equal(new URL(window.location.href).origin, new URL(before).origin, 'the browser was not sent to Accounts');

  await unmountApp(root);
  resetCookie();
});
