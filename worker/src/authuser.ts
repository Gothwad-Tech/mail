// =============================================================================
// Per-tab account selector (`authuser`).
//
// Google's Gmail puts the account in the URL: /u/0/, /u/1/ ... That number is
// what makes two tabs independent: each tab sends its own selector, and the
// Accounts service resolves THAT slot without touching the browser-wide
// "active account" cookie. So Tab A on /u/0 can read and send as pawan while
// Tab B on /u/1 is signed in as work.
//
// Accounts accepts the selector in three forms, and we pass all three through:
//   X-Gothwad-Authuser: 0        (header, used by every Mail API call)
//   ?authuser=0 / ?u=0           (query, used by links and first paint)
//   slot id 'a'..'f' | username  (also accepted upstream)
//
// Anything else is ignored, so a hand-crafted header can never reach the
// upstream lookup as something unexpected.
// =============================================================================

/** 0..5 = Google's six browser slots. */
export const MAX_AUTHUSER = 5;

const INDEX_RE = /^\d$/;
const SLOT_RE = /^[a-f]$/;
const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/**
 * Normalises a selector to "0".."5", a slot letter, or a username.
 * Returns null for anything else (empty, "6", "abc!", an email is allowed).
 */
export function normalizeAuthUser(raw: unknown): string | null {
  // JSON bodies may carry the index as a number: { authuser: 1 }.
  const asText = typeof raw === 'number' && Number.isInteger(raw) ? String(raw) : raw;
  if (typeof asText !== 'string') return null;
  const value = asText.trim().toLowerCase();
  if (!value) return null;
  if (INDEX_RE.test(value)) {
    return Number(value) <= MAX_AUTHUSER ? value : null;
  }
  if (SLOT_RE.test(value)) return value;
  const local = value.includes('@') ? value.split('@')[0] : value;
  return USERNAME_RE.test(local) ? local : null;
}

/**
 * The tab's account selector for a request: header first (set by the web app on
 * every API call), then `?authuser=` / `?u=` (used by a first hard navigation
 * before the app has booted). This is the ONLY place the selector is read.
 */
export function authUserFromRequest(request: Request): string | null {
  const header = normalizeAuthUser(request.headers.get('x-gothwad-authuser'));
  if (header) return header;

  const url = new URL(request.url);
  return normalizeAuthUser(url.searchParams.get('authuser')) ?? normalizeAuthUser(url.searchParams.get('u'));
}

/** "0" -> 0. Used when a numeric index is needed (URL paths, sorting). */
export function authUserIndex(selector: string | null): number {
  if (selector && INDEX_RE.test(selector)) return Number(selector);
  return 0;
}
