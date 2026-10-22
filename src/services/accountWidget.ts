// =============================================================================
// Loader for the shared Gothwad account widget (hosted once by Accounts).
//
// The same Google-style sheet is used by Accounts, Mail, Store and Console, so
// Mail must not ship a second, slightly different menu. Accounts publishes it at
// `${accountsWebOrigin}/widget/account-menu.js`; that module defines
// `window.GothwadAccountMenu` with `open / update / close / isOpen`.
//
// Design notes:
//   - the origin comes from the session (`accountsWebOrigin`), never from a
//     hardcoded domain, so this keeps working when the domain changes
//   - loading is a dynamic ES-module import: module scripts are CORS-fetched by
//     the browser, and Accounts serves `/widget/*` with `Access-Control-Allow-Origin: *`
//   - the import is started quietly right after boot, so tapping the avatar opens
//     the sheet with no network wait
//   - every failure is reported (never thrown at the UI): the sheet falls back to
//     the small in-app menu rather than doing nothing
// =============================================================================

/** The public surface the widget module exports. Everything is optional: the
 * module is remote code, so the loader checks before calling. */
export interface AccountWidget {
  open?: (state?: unknown, opts?: unknown) => void;
  update?: (state?: unknown, opts?: unknown) => void;
  close?: () => void;
  isOpen?: () => boolean;
}

/** Path Accounts serves the widget on (same file, every app). */
export const WIDGET_PATH = '/widget/account-menu.js';

/** A slow network must not leave the avatar dead: after this, use the fallback. */
const LOAD_TIMEOUT_MS = 5000;

let loaded: AccountWidget | null = null;
let inFlight: { url: string; promise: Promise<AccountWidget | null> } | null = null;
let lastError: string | null = null;

/**
 * The object the widget registers itself on. In a browser that is `globalThis`
 * itself; in a test harness (jsdom) the page globals live on `globalThis.window`,
 * so both are checked and the page one wins.
 */
type WidgetGlobal = { GothwadAccountMenu?: AccountWidget; window?: WidgetGlobal };
const menuGlobal = (): WidgetGlobal => (globalThis as WidgetGlobal).window ?? (globalThis as WidgetGlobal);

/** Trims trailing slashes; returns '' for an unusable value. */
function normalizeOrigin(raw: string | null | undefined): string {
  if (typeof raw !== 'string') return '';
  return raw.trim().replace(/\/+$/, '');
}

/**
 * URL of the widget. Absolute when it lives on another origin (production), and
 * the plain path when it is this origin (development, where the dev server
 * proxies `/widget` to the local Accounts stand-in).
 */
export function accountWidgetUrl(accountsWebOrigin: string): string {
  const origin = normalizeOrigin(accountsWebOrigin);
  if (!origin) return WIDGET_PATH;
  const page = (globalThis as { location?: { host?: string } }).location;
  // Same host (ignoring the scheme, so an https preview of an http dev server
  // still works) means the plain path is the correct URL.
  try {
    return page?.host && new URL(origin).host === page.host ? WIDGET_PATH : `${origin}${WIDGET_PATH}`;
  } catch {
    return `${origin}${WIDGET_PATH}`;
  }
}

/** The widget module, only if it has already loaded (never triggers a fetch). */
export function loadedAccountWidget(): AccountWidget | null {
  if (loaded) return loaded;
  const fromWindow = menuGlobal().GothwadAccountMenu;
  return fromWindow && typeof fromWindow === 'object' ? fromWindow : null;
}

/** Why the last load failed, for the message the fallback menu shows. */
export function accountWidgetError(): string | null {
  return lastError;
}

/** True when the widget namespace (or window global) looks usable. */
function usable(mod: unknown): AccountWidget | null {
  const candidate =
    (mod as { GothwadAccountMenu?: AccountWidget } | null)?.GothwadAccountMenu ??
    menuGlobal().GothwadAccountMenu;
  return candidate && typeof candidate === 'object' ? candidate : null;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

/**
 * Loads the widget once. Repeated calls share the same promise, so a click while
 * the preload is still running waits for that request instead of starting another.
 */
export function loadAccountWidget(accountsWebOrigin: string): Promise<AccountWidget | null> {
  const already = loadedAccountWidget();
  if (already) {
    loaded = already;
    return Promise.resolve(already);
  }

  const url = accountWidgetUrl(accountsWebOrigin);
  if (inFlight && inFlight.url === url) return inFlight.promise;

  lastError = null;
  const promise = withTimeout(import(/* @vite-ignore */ url), LOAD_TIMEOUT_MS)
    .then((mod) => {
      const api = usable(mod);
      if (!api) {
        lastError = 'The account widget loaded but exported no menu.';
        return null;
      }
      loaded = api;
      return api;
    })
    .catch((err: unknown) => {
      // Offline, blocked by a proxy, or Accounts is redeploying: keep the sheet
      // usable with the local fallback instead of failing the click.
      lastError = err instanceof Error ? err.message : 'The account widget could not be loaded.';
      return null;
    })
    .finally(() => {
      inFlight = null;
    });

  inFlight = { url, promise };
  return promise;
}

/**
 * Warms the module without blocking anything. Called once the session says who
 * the user is, so the first avatar tap is instant.
 */
export function preloadAccountWidget(accountsWebOrigin: string): void {
  if (typeof window === 'undefined' || !normalizeOrigin(accountsWebOrigin)) return;
  const start = () => void loadAccountWidget(accountsWebOrigin);
  const idle = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: unknown) => number })
    .requestIdleCallback;
  if (typeof idle === 'function') idle(start, { timeout: 2000 });
  else setTimeout(start, 600);
}

export type OpenAccountWidgetResult =
  | { ok: true }
  | { ok: false; reason: 'not_loaded' | 'no_open'; message: string };

/** Opens the sheet. Returns a result instead of throwing: the UI shows a fallback. */
export async function openAccountWidget(
  accountsWebOrigin: string,
  state: unknown,
  opts: unknown
): Promise<OpenAccountWidgetResult> {
  const api = await loadAccountWidget(accountsWebOrigin);
  if (!api) {
    return { ok: false, reason: 'not_loaded', message: lastError ?? 'The account widget is unavailable.' };
  }
  if (typeof api.open !== 'function') {
    return { ok: false, reason: 'no_open', message: 'The account widget has no open() method.' };
  }
  api.open(state, opts);
  return { ok: true };
}

/** Live state push while the sheet is open (unread counts, theme, accounts). */
export function updateAccountWidget(state: unknown, opts: unknown): void {
  const api = loadedAccountWidget();
  if (!api || typeof api.update !== 'function') return;
  api.update(state, opts);
}

export function isAccountWidgetOpen(): boolean {
  const api = loadedAccountWidget();
  return typeof api?.isOpen === 'function' ? api.isOpen() === true : false;
}

export function closeAccountWidget(): void {
  const api = loadedAccountWidget();
  if (api && typeof api.close === 'function') api.close();
}

/** Test-only: forget the loaded module and the cached promise. */
export function resetAccountWidgetForTests(): void {
  loaded = null;
  inFlight = null;
  lastError = null;
  delete menuGlobal().GothwadAccountMenu;
  delete (globalThis as WidgetGlobal).GothwadAccountMenu;
}

/** Test-only: pretend the module is already cached. */
export function setAccountWidgetForTests(api: AccountWidget | null): void {
  loaded = api;
  lastError = null;
}
