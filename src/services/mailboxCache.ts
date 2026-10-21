// =============================================================================
// Per-account in-memory mailbox cache.
//
// Why module level: switching accounts remounts the provider (keyed by slot), so
// a cache inside React state would die exactly when we want it. Keeping it here
// lets the new account paint its last inbox in the same frame, then revalidate.
//
// Rules:
//   - keyed by Accounts slot id ("a".."f"), never by username-derived data
//   - dies with the tab (a page reload starts clean)
//   - dropped immediately when that account signs out
//   - NEVER holds tokens, only message data the tab already displayed
// =============================================================================

import type { EmailFolder, EmailMessage } from '../types/email';

export interface CachedFolder {
  emails: EmailMessage[];
  hasMore: boolean;
  at: number;
}

export interface AccountMailboxCache {
  folders: Map<EmailFolder, CachedFolder>;
  details: Map<string, EmailMessage>;
  prefetching: Set<string>;
}

const caches = new Map<string, AccountMailboxCache>();

/** The cache for one account, created on first use. */
export function accountMailboxCache(key: string): AccountMailboxCache {
  let cache = caches.get(key);
  if (!cache) {
    cache = { folders: new Map(), details: new Map(), prefetching: new Set() };
    caches.set(key, cache);
  }
  return cache;
}

/** Sign-out: that account's mailbox must not survive in memory. */
export function dropAccountMailboxCache(key: string): void {
  caches.delete(key);
}

/** Test helper / full reset on a hard sign-out. */
export function clearAllMailboxCaches(): void {
  caches.clear();
}
