// =============================================================================
// Session hook: asks the Mail Worker "who is signed in?" once on load.
//
// - 200 -> ready (we have the user + limits).
// - 401 -> the browser is not signed in to Gothwad Accounts. Send the user to
//          the Accounts signin page with ?next= back to this Mail page.
// - other -> show an error with a retry button (no fake signed-in state).
// =============================================================================

import { useCallback, useEffect, useState } from 'react';
import { ApiError, mailApi, SessionInfo } from '../services/mailApi';

export type SessionState =
  | { status: 'loading' }
  | { status: 'redirecting' }
  | { status: 'ready'; info: SessionInfo }
  | { status: 'error'; message: string };

/** Builds the Accounts sign-in URL that returns the user here after login. */
export function buildSigninUrl(signinBase: string, returnTo: string): string {
  const url = new URL(signinBase);
  url.searchParams.set('next', returnTo);
  return url.toString();
}

export function useSession() {
  const [state, setState] = useState<SessionState>({ status: 'loading' });

  const load = useCallback(() => {
    setState({ status: 'loading' });
    mailApi
      .getSession()
      .then((info) => setState({ status: 'ready', info }))
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 401 && err.signinUrl) {
          setState({ status: 'redirecting' });
          window.location.replace(buildSigninUrl(err.signinUrl, window.location.href));
          return;
        }
        const message =
          err instanceof ApiError && err.status === 401
            ? 'Sign-in is not configured for this Worker yet.'
            : err instanceof Error
              ? err.message
              : 'Could not check your session.';
        setState({ status: 'error', message });
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { state, retry: load };
}
