// =============================================================================
// The optional half of the session: unread badges and the send quota.
//
// It runs only AFTER identity is verified, and it is never allowed to block the
// shell. Three outcomes, all of them safe:
//
//   ready  -> real numbers, tagged with the account they belong to
//   error  -> the shell is untouched; the sidebar offers a Retry for this strip
//   loading-> section skeletons, and `null` values everywhere else
//
// `unread` stays `null` when the count failed, so no screen can render a
// misleading "0 unread". Every answer is checked twice before it is used: the
// request generation must still be current, and the server-reported `authuser`
// must equal the account this tab shows. A late answer for account A therefore
// cannot paint badges on account B.
// =============================================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import type { SessionLimits } from '../services/mailApi';
import { requestSessionMeta } from '../services/sessionClient';
import { sessionErrorMessage } from './useSession';

export type SessionMetaState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | {
      status: 'ready';
      /** Which account these numbers describe. */
      authuser: number;
      unread: Record<string, number> | null;
      limits: SessionLimits;
    };

export function useSessionMeta(enabled: boolean, authuser: number, epoch: number) {
  const [state, setState] = useState<SessionMetaState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const attemptRef = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    const current = ++attemptRef.current;
    setState({ status: 'loading' });

    const shared = requestSessionMeta(authuser);
    let live = true;

    shared.promise
      .then((meta) => {
        if (!live || current !== attemptRef.current) return;
        if (meta.authuser !== authuser) {
          // The tab moved to another account while this was in the air. Drop it;
          // the effect for the new account owns the strip now.
          return;
        }
        setState({ status: 'ready', authuser: meta.authuser, unread: meta.unread, limits: meta.limits });
      })
      .catch((err: unknown) => {
        if (!live || current !== attemptRef.current) return;
        setState({ status: 'error', message: sessionErrorMessage(err) });
      });

    return () => {
      live = false;
      attemptRef.current += 1;
      // Aborts the network call if this was the only caller left.
      shared.release();
    };
  }, [enabled, authuser, epoch, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return { state, retry };
}
