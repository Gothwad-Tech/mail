// =============================================================================
// Session requests that are shared instead of repeated.
//
// Startup used to ask "who is signed in?" once per consumer, and a remount (or
// React's development StrictMode double effect) asked again. That is a second
// Accounts verification for an answer that is already on the wire, so this
// module keeps exactly one in-flight request per endpoint + account selector:
//
//   identity:<authuser>   GET /api/session?meta=0
//   meta:<authuser>       GET /api/session/meta
//
// Rules that matter for security and for the UI:
//   * the account selector is part of the key, so /u/0 and /u/1 never share an
//     answer (late results cannot cross accounts);
//   * nothing is cached once the request settles — no long-lived authenticated
//     payload lives in memory, storage or a service worker;
//   * every caller releases when it stops caring (unmount, account change) and
//     the LAST release aborts the network call, so an abandoned request cannot
//     keep running or resolve into state nobody owns.
// =============================================================================

import { mailApi, type SessionInfo, type SessionMetaInfo } from './mailApi';
import { currentAuthUser } from './authuser';

export interface SharedRequest<T> {
  promise: Promise<T>;
  /** Detach this caller. The last one out cancels the pending request. */
  release: () => void;
}

interface Pending {
  controller: AbortController;
  promise: Promise<unknown>;
  subscribers: number;
  settled: boolean;
}

/** Only requests that have not settled yet live here. */
const pending = new Map<string, Pending>();

function share<T>(key: string, start: (signal: AbortSignal) => Promise<T>): SharedRequest<T> {
  let entry = pending.get(key);

  if (!entry) {
    const controller = new AbortController();
    const created: Pending = {
      controller,
      subscribers: 0,
      settled: false,
      promise: undefined as unknown as Promise<unknown>,
    };
    // `.finally` runs for both outcomes, so the entry disappears exactly once.
    created.promise = start(controller.signal).finally(() => {
      created.settled = true;
      if (pending.get(key) === created) pending.delete(key);
    });
    pending.set(key, created);
    entry = created;
  }

  const shared = entry;
  shared.subscribers += 1;
  let released = false;

  return {
    promise: shared.promise as Promise<T>,
    release() {
      if (released) return;
      released = true;
      shared.subscribers -= 1;
      if (shared.subscribers > 0 || shared.settled) return;
      if (pending.get(key) === shared) pending.delete(key);
      shared.controller.abort();
    },
  };
}

/** Identity for this tab's account. Callers share one Accounts verification. */
export function requestIdentity(): SharedRequest<SessionInfo & { authenticated: true }> {
  const authuser = currentAuthUser();
  return share(`identity:${authuser}`, (signal) => mailApi.getSession({ signal, authuser }));
}

/** Unread badges + send quota for one account, shared by its callers. */
export function requestSessionMeta(authuser = currentAuthUser()): SharedRequest<SessionMetaInfo> {
  return share(`meta:${authuser}`, (signal) => mailApi.getSessionMeta({ signal, authuser }));
}

/** How many requests are in flight. Exposed for tests, never for UI. */
export function pendingSessionRequests(): number {
  return pending.size;
}

/** Aborts everything (sign-out, tests). Nothing is kept afterwards. */
export function resetSessionRequests(): void {
  for (const entry of pending.values()) {
    entry.controller.abort();
  }
  pending.clear();
}
