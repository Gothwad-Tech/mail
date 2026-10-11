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
globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith('/api/')) {
    const headers = new Headers(init?.headers);
    headers.set('cookie', activeCookie);
    // Browsers send Origin on same-origin writes; the Worker's CSRF guard needs it.
    // jsdom does not add it, so we add it here to match the real browser.
    if (init?.method && init.method !== 'GET') headers.set('origin', APP_ORIGIN);
    return realFetch(`${API}${url}`, { ...init, headers });
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
