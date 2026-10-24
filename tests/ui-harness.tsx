// Shared jsdom harness for the UI tests.
//
// It installs the browser globals React needs, proxies `/api/*` to the running
// Worker (npm run worker:dev) while emulating the browser cookie jar, and
// exposes a render/unmount pair. Both ui-*.test files import this module, so
// React and the App module are loaded exactly once per process.

import { JSDOM } from 'jsdom';

export const API = process.env.MAIL_API_ORIGIN || 'http://127.0.0.1:8787';
export const APP_ORIGIN = 'http://localhost:3000';
export const GOOD_COOKIE = process.env.MAIL_TEST_COOKIE || 'gothwad_at=good';

let activeCookie = GOOD_COOKIE;
export const setCookie = (cookie: string) => {
  activeCookie = cookie;
};
export const resetCookie = () => {
  activeCookie = GOOD_COOKIE;
};

/**
 * Puts the local Accounts stub back to "alice and bob are both signed in".
 * Sign-out is stateful inside that stub, so tests must not leak it to each other.
 */
export async function resetAccounts(): Promise<void> {
  resetCookie();
  await realFetch(`${API}/__local/reset-accounts`, { method: 'POST' });
}

/**
 * Lets a test answer one API path itself instead of forwarding it to the Worker.
 * Used by the startup tests to hold `/api/session/meta` open (a slow database)
 * or to fail it (an unreachable one) while the rest of the app runs for real.
 * Return null to fall through to the Worker.
 */
export type ApiInterceptor = (url: string, init?: RequestInit) => Promise<Response | null> | Response | null;
let apiInterceptor: ApiInterceptor | null = null;
export const setApiInterceptor = (fn: ApiInterceptor | null): void => {
  apiInterceptor = fn;
};

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: `${APP_ORIGIN}/`,
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
setGlobal('sessionStorage', dom.window.sessionStorage);
setGlobal('MutationObserver', dom.window.MutationObserver);
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
    const intercepted = apiInterceptor ? await apiInterceptor(url, init) : null;
    if (intercepted) return intercepted;
    const headers = new Headers(init?.headers);
    headers.set('cookie', activeCookie);
    // Browsers send Origin on same-origin writes; the Worker's CSRF guard needs it.
    // jsdom does not add it, so we add it here to match the real browser.
    if (init?.method && init.method !== 'GET') headers.set('origin', APP_ORIGIN);
    const res = await realFetch(`${API}${url}`, { ...init, headers });
    // jsdom does not keep a cookie jar, so do what a browser would: remember
    // rotated cookies (the account switcher relies on this to change identity).
    const setCookieHeader = res.headers.get('set-cookie');
    if (setCookieHeader) {
      for (const pair of setCookieHeader.split(/,(?=[^;]+?=)/)) {
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

const React = await import('react');
const { createRoot } = await import('react-dom/client');
export const { act, createElement } = React;
const AppModule = await import('../src/App.tsx');
export const App = AppModule.default;

export const text = () => document.body.textContent || '';

export async function waitFor(check: () => boolean, label: string, timeoutMs = 8000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (check()) return;
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
  }
  throw new Error(`Timed out waiting for: ${label}`);
}

type Root = ReturnType<typeof createRoot>;

/** Renders the real <App /> into #root and returns its React root. */
export async function mountApp(url?: string): Promise<Root> {
  if (url) window.history.replaceState(window.history.state, '', url);
  const root = createRoot(document.getElementById('root')!);
  await act(async () => {
    root.render(createElement(App));
  });
  return root;
}

/** Unmounts and resets the DOM + URL, so the next test starts clean. */
export async function unmountApp(root: Root, url = '/'): Promise<void> {
  await act(async () => {
    root.unmount();
  });
  document.body.innerHTML = '<div id="root"></div>';
  window.history.replaceState(window.history.state, '', url);
}

/** Fires a window-level keydown, the way a real browser would. */
export async function pressKey(key: string, init: KeyboardEventInit = {}): Promise<void> {
  await act(async () => {
    window.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, ...init }));
  });
}

/** Dispatches a keydown on the focused element inside the open sheet. */
export async function pressOnFocus(key: string): Promise<void> {
  await act(async () => {
    (document.activeElement as HTMLElement).dispatchEvent(
      new window.KeyboardEvent('keydown', { key, bubbles: true })
    );
  });
}

/** The header avatar button that opens the account sheet. */
export function accountTrigger(): HTMLButtonElement | undefined {
  return [...document.querySelectorAll('button')].find((b) =>
    /Accounts \(\d\)|Account details|User profile/.test(b.getAttribute('aria-label') || '')
  );
}

/** The in-app fallback sheet (the shared widget renders in a shadow root). */
export function accountDialog(): HTMLElement | null {
  return document.querySelector('[role="dialog"][aria-modal="true"]');
}

// ---------------------------------------------------------------------------
// The shared account widget
//
// In a browser, Mail dynamically imports `${accountsWebOrigin}/widget/account-menu.js`.
// jsdom cannot import an http URL, so the tests load Mail's local stand-in
// (tools/account-menu-widget.stub.js, served by the dev server at exactly that
// path) and install it as `window.GothwadAccountMenu` — which is what the loader
// checks first. Mail's own code path (loader -> open(state, opts) -> callbacks)
// is therefore exercised for real, not mocked.
// ---------------------------------------------------------------------------

export interface WidgetCall {
  state: Record<string, unknown> & { accounts?: Array<{ id: string; authuser: number; email: string }> };
  opts: Record<string, unknown> & { anchorEl?: HTMLElement | null; badges?: Record<string, number> };
}

export interface WidgetRig {
  calls: WidgetCall[];
  close: () => void;
  isOpen: () => boolean;
}

/** Installs the widget stand-in and records every open()/update() call. */
export async function installAccountWidget(): Promise<WidgetRig> {
  const { resetAccountWidgetForTests } = await import('../src/services/accountWidget.ts');
  // The stand-in is plain JS; the widget contract is what matters here.
  const stub = (await import('../tools/account-menu-widget.stub.js')).GothwadAccountMenu as {
    open: (state?: Record<string, unknown>, opts?: Record<string, unknown>) => void;
    update: (state?: Record<string, unknown>, opts?: Record<string, unknown>) => void;
    close: () => void;
    isOpen: () => boolean;
  };
  resetAccountWidgetForTests();
  stub.close();

  const calls: WidgetCall[] = [];
  const api = {
    open: (state: Record<string, unknown> = {}, opts: Record<string, unknown> = {}) => {
      calls.push({ state, opts });
      stub.open(state, opts);
    },
    update: (state: Record<string, unknown> = {}, opts: Record<string, unknown> = {}) => {
      stub.update(state, opts);
    },
    close: () => stub.close(),
    isOpen: () => stub.isOpen(),
  };
  (window as unknown as { GothwadAccountMenu?: unknown }).GothwadAccountMenu = api;
  return { calls, close: () => stub.close(), isOpen: () => stub.isOpen() };
}

/** Removes the widget, so Mail falls back to its own built-in sheet. */
export async function removeAccountWidget(): Promise<void> {
  const { resetAccountWidgetForTests } = await import('../src/services/accountWidget.ts');
  resetAccountWidgetForTests();
}

/** The widget's shadow root (it renders inside one), or null when closed. */
export function sheetShadow(): ShadowRoot | null {
  const host = document.querySelector('[data-gothwad-account-menu-stub]');
  return (host?.shadowRoot as ShadowRoot | null) ?? null;
}

/** True when the shared widget is the thing on screen. */
export const isWidgetSheetOpen = (): boolean => Boolean(sheetShadow());

/** Text of the open sheet, whichever implementation rendered it. */
export function sheetText(): string {
  const shadow = sheetShadow();
  return shadow ? shadow.textContent || '' : '';
}

/** Click the first element inside the sheet (widget or fallback) matching a text. */
export async function clickInSheet(match: (text: string, el: HTMLElement) => boolean): Promise<boolean> {
  const root: ParentNode = sheetShadow() ?? document.body;
  const candidates = [...root.querySelectorAll<HTMLElement>('button, a, [role="button"]')];
  // textContent keeps the template's indentation; compare trimmed text.
  const target = candidates.find((el) => match((el.textContent || '').trim(), el));
  if (!target) return false;
  await act(async () => {
    target.click();
  });
  return true;
}
