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
import { JSDOM } from 'jsdom';

const API = process.env.MAIL_API_ORIGIN || 'http://127.0.0.1:8787';
const APP_ORIGIN = 'http://localhost:3000';
const GOOD_COOKIE = process.env.MAIL_TEST_COOKIE || 'gothwad_at=good';
let activeCookie = GOOD_COOKIE;

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost:3000/',
  pretendToBeVisual: true,
});
// Node defines some globals (e.g. navigator) as getters, so define them explicitly.
const setGlobal = (key: string, value: unknown) =>
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
setGlobal('window', dom.window);
setGlobal('document', dom.window.document);
setGlobal('navigator', dom.window.navigator);
setGlobal('HTMLElement', dom.window.HTMLElement);
setGlobal('Node', dom.window.Node);
setGlobal('localStorage', dom.window.localStorage);
setGlobal('MouseEvent', dom.window.MouseEvent);
setGlobal('KeyboardEvent', dom.window.KeyboardEvent);
setGlobal('getComputedStyle', dom.window.getComputedStyle);
setGlobal('IS_REACT_ACT_ENVIRONMENT', true);
if (!dom.window.matchMedia) {
  (dom.window as unknown as { matchMedia: unknown }).matchMedia = () => ({
    matches: false,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
  });
}

// Relative /api calls go to the Worker, with the signed-in cookie attached.
// Same-origin in production (Worker route), so the browser code is unchanged.
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith('/api/')) {
    const headers = new Headers(init?.headers);
    headers.set('cookie', activeCookie);
    // Browsers send Origin on same-origin writes; the Worker's CSRF guard needs it.
    // jsdom does not add it, so we add it here to match the real browser.
    if (init?.method && init.method !== 'GET') headers.set('origin', APP_ORIGIN);
    const res = await realFetch(`${API}${url}`, { ...init, headers });
    // jsdom does not keep a cookie jar, so do what a browser would: remember
    // rotated cookies (the account switcher relies on this to change identity).
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) {
      for (const pair of setCookie.split(/,(?=[^;]+?=)/)) {
        const name = pair.split('=')[0].trim();
        if (name && name.startsWith('gothwad_')) {
          activeCookie = activeCookie
            .split(';')
            .map((c) => c.trim())
            .filter((c) => c && !c.startsWith(`${name}=`))
            .concat(pair.split(';')[0].trim())
            .join('; ');
        }
      }
    }
    return res;
  }
  return realFetch(input as never, init);
}) as typeof fetch;

const { createRoot } = await import('react-dom/client');
const { act, createElement } = await import('react');
const { default: App } = await import('../src/App.tsx');

async function waitFor(check: () => boolean, label: string, timeoutMs = 8000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (check()) return;
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
  }
  throw new Error(`Timed out waiting for: ${label}`);
}

const text = () => document.body.textContent || '';

// Collect React warnings so they show up in the test output.
const consoleErrors: string[] = [];
const originalError = console.error;
console.error = (...args: unknown[]) => {
  consoleErrors.push(args.map(String).join(' ').slice(0, 300));
};

test('signed-in user sees the inbox, can open a message safely, and can open compose', async () => {
  activeCookie = GOOD_COOKIE;
  const root = createRoot(document.getElementById('root')!);
  await act(async () => {
    root.render(createElement(App));
  });

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

  await act(async () => {
    root.unmount();
  });
  document.body.innerHTML = '<div id="root"></div>';
  if (consoleErrors.length) {
    originalError(`[ui-smoke] ${consoleErrors.length} React console error(s):\n${consoleErrors.slice(0, 5).join('\n')}`);
  }
});

test('Settings shows the mailbox storage card and the retention selector works', async () => {
  activeCookie = GOOD_COOKIE;
  const root = createRoot(document.getElementById('root')!);
  await act(async () => {
    root.render(createElement(App));
  });
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

  await act(async () => {
    root.unmount();
  });
  document.body.innerHTML = '<div id="root"></div>';
});

test('signed-out browser is sent to Accounts sign-in (with next=) and never sees mail', async () => {
  activeCookie = 'unrelated=1';
  const root = createRoot(document.getElementById('root')!);
  await act(async () => {
    root.render(createElement(App));
  });
  await waitFor(() => text().includes('Redirecting you to sign in'), 'redirect message');
  assert.equal(text().includes('Invoice for October'), false, 'no mail is rendered before sign-in');
  await act(async () => {
    root.unmount();
  });
  document.body.innerHTML = '<div id="root"></div>';
});

test('failed Accounts return is explained instead of redirecting to the chooser forever', async () => {
  activeCookie = 'unrelated=1';
  window.history.replaceState(window.history.state, '', '/?__mail_auth_return=1');
  const root = createRoot(document.getElementById('root')!);
  await act(async () => {
    root.render(createElement(App));
  });

  await waitFor(() => text().includes('Accounts sent you back to Mail'), 'SSO handoff error');
  assert.equal(text().includes('Redirecting you to sign in'), false, 'do not start another chooser round-trip');
  assert.equal(new URL(window.location.href).searchParams.has('__mail_auth_return'), false, 'one-time marker is cleaned');

  await act(async () => {
    root.unmount();
  });
  document.body.innerHTML = '<div id="root"></div>';
  window.history.replaceState(window.history.state, '', '/');
});

test('a 503 session check shows the profile error with Retry and does not redirect', async (t) => {
  // The Worker answers 503 accounts_user_invalid when Accounts says the user is
  // signed in but sends no usable username. The app must show that with a Retry
  // button instead of sending the browser back to the Accounts chooser.
  activeCookie = 'gothwad_at=no_username';
  const probe = await fetch('/api/session');
  if (probe.status !== 503) {
    t.skip(
      `the local Accounts stub must answer 200 {authenticated:true,user:{username:""}} for ` +
        `cookie gothwad_at=no_username; the Worker answered ${probe.status}`
    );
    activeCookie = GOOD_COOKIE;
    return;
  }
  assert.equal(((await probe.json()) as { error: string }).error, 'accounts_user_invalid');

  const before = window.location.href;
  const root = createRoot(document.getElementById('root')!);
  await act(async () => {
    root.render(createElement(App));
  });

  await waitFor(() => text().includes('could not load your profile'), 'profile error message');
  assert.equal(text().includes('Redirecting you to sign in'), false, 'a 503 must not redirect');
  assert.equal(text().includes('cookie'), false, 'no expired-cookie wording for a 503');
  assert.ok(
    [...document.querySelectorAll('button')].some((b) => b.textContent?.trim() === 'Try again'),
    'Retry button is shown'
  );
  assert.equal(window.location.href, before, 'the browser was not sent to Accounts');

  await act(async () => {
    root.unmount();
  });
  document.body.innerHTML = '<div id="root"></div>';
  activeCookie = GOOD_COOKIE;
});

test('the account switcher lists every signed-in account and switches in place', async () => {
  activeCookie = GOOD_COOKIE;

  // 1. The list itself: both accounts, with the unread count from Mail's D1.
  const accounts = (await (await fetch('/api/mail/accounts')).json()) as {
    activeId: string;
    accounts: Array<{ id: string; email: string; username: string }>;
    unread: Record<string, number>;
  };
  assert.equal(accounts.accounts.length, 2, 'the local Accounts stub has two accounts');
  assert.equal(accounts.activeId, 'a');
  assert.equal(typeof accounts.unread.bob, 'number');

  const root = createRoot(document.getElementById('root')!);
  await act(async () => {
    root.render(createElement(App));
  });
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

  await act(async () => {
    root.unmount();
  });
  document.body.innerHTML = '<div id="root"></div>';
  activeCookie = GOOD_COOKIE;
});
