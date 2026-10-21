// =============================================================================
// Per-tab account index, Gmail style.
//
//   /u/0/  /u/1/  ...            canonical (0..5)
//   /mail/u/1/                   Gmail-compatible alias
//   /?authuser=1  /?u=1          first navigation / shared links
//   /?login=1&authuser=1         Gmail's post-sign-in URL
//
// The number in the URL is the ONLY source of truth for which account a tab is
// showing. Every API call sends it as `X-Gothwad-Authuser`, so two tabs on
// /u/0/ and /u/1/ read and send as two different accounts even though they share
// one cookie jar. Nothing here is stored in localStorage/sessionStorage: a tab's
// identity is in its URL, so a duplicate tab and Back/Forward keep working.
// =============================================================================

import type { EmailFolder } from '../types/email';

export const AUTHUSER_HEADER = 'X-Gothwad-Authuser';
export const MAX_AUTHUSER = 5;

const FOLDERS: readonly EmailFolder[] = ['inbox', 'starred', 'sent', 'drafts', 'trash'];

/** `#inbox` -> 'inbox'. Unknown/absent hashes fall back to the inbox. */
export function folderFromHash(hash = window.location.hash): EmailFolder {
  const name = hash.replace(/^#\/?/, '').split(/[/?]/)[0] as EmailFolder;
  return FOLDERS.includes(name) ? name : 'inbox';
}

/** The hash for a folder. The inbox uses `#inbox` (Gmail shows `#inbox` too). */
export function hashForFolder(folder: EmailFolder): string {
  return `#${folder}`;
}

function validIndex(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  if (!/^\d$/.test(raw)) return null;
  const n = Number(raw);
  return n <= MAX_AUTHUSER ? n : null;
}

/** `/u/2/` or `/mail/u/2/x` -> 2. Null when the path carries no index. */
function indexFromPath(pathname: string): number | null {
  const match = /^\/(?:mail\/)?u\/(\d)(?:\/|$)/.exec(pathname);
  return match ? validIndex(match[1]) : null;
}

/**
 * The account index this tab is on, read fresh from the URL every time.
 * Defaults to 0 (Google's default account) when the URL has no index yet.
 */
export function currentAuthUser(): number {
  const { pathname, search } = window.location;
  const fromPath = indexFromPath(pathname);
  if (fromPath !== null) return fromPath;
  const params = new URLSearchParams(search);
  return validIndex(params.get('authuser')) ?? validIndex(params.get('u')) ?? 0;
}

/** Header object for a fetch call. `authuser` is always present (0..5). */
export function authUserHeaders(index = currentAuthUser()): Record<string, string> {
  return { [AUTHUSER_HEADER]: String(index) };
}

/** Canonical path for an account + folder. */
export function authUserPath(index: number, folder?: EmailFolder): string {
  const base = `/u/${Math.min(Math.max(index, 0), MAX_AUTHUSER)}/`;
  return folder ? `${base}${hashForFolder(folder)}` : base;
}

/**
 * Rewrites the address bar to the canonical `/u/<n>/#<folder>` form without a
 * navigation, keeping the current folder. Returns the resolved index.
 *
 * Called once on boot: `/mail/u/1/#sent`, `/?authuser=1&folder=sent` and
 * `/u/1/#sent` all end up as the same URL, so refresh and sharing always work.
 */
export function normalizeAuthUserUrl(): number {
  const index = currentAuthUser();
  const { pathname, search } = window.location;
  const params = new URLSearchParams(search);

  // `?folder=` only exists for the old PWA shortcuts; it becomes the hash.
  const legacyFolder = params.get('folder');
  const folder =
    legacyFolder && FOLDERS.includes(legacyFolder as EmailFolder)
      ? (legacyFolder as EmailFolder)
      : folderFromHash();
  // Only the account shortcuts are consumed. Every other param (`compose=1`,
  // the `__mail_auth_return` marker, anything Accounts appends) is a one-shot
  // action that the app still has to see, so it rides along unchanged.
  for (const key of ['authuser', 'u', 'login', 'folder']) params.delete(key);
  const rest = params.toString();
  // Query goes before the hash: /u/1/?compose=1#inbox
  const canonical = `${authUserPath(index)}${rest ? `?${rest}` : ''}${hashForFolder(folder)}`;

  // Canonical means exactly `/u/<n>/#<folder>`. Anything else (an alias path, a
  // query form, a bare `/`) is rewritten once, without adding history.
  if (`${pathname}${window.location.search}${window.location.hash}` !== canonical) {
    window.history.replaceState(window.history.state, '', canonical);
  }
  return index;
}

/** Folder change without a reload: `/u/1/#inbox` -> `/u/1/#sent`. */
export function writeFolderToUrl(folder: EmailFolder): void {
  const next = authUserPath(currentAuthUser(), folder);
  if (window.location.pathname + window.location.hash !== next) {
    window.history.replaceState(window.history.state, '', next);
  }
}

/** Account change in the same tab: pushes a history entry (Back returns here). */
export function navigateToAccount(index: number, folder: EmailFolder): void {
  const next = authUserPath(index, folder);
  if (window.location.pathname + window.location.hash !== next) {
    window.history.pushState({ authuser: index }, '', next);
  }
}

/** Back/Forward between /u/0 and /u/1. Returns the unsubscribe function. */
export function onUrlAccountChange(handler: (index: number) => void): () => void {
  const listener = () => handler(currentAuthUser());
  window.addEventListener('popstate', listener);
  return () => window.removeEventListener('popstate', listener);
}

/** True when the current URL belongs to the given account index. */
export function urlMatchesAccount(index: number): boolean {
  return currentAuthUser() === index;
}
