// =============================================================================
// Session hook: asks the Mail Worker "who is signed in?" once on load.
//
// - 200 -> ready (we have the user + limits).
// - 401 -> send the browser to Accounts with ?next= back to this Mail page.
//          If that return still gets 401, show an error instead of looping.
// - other -> show an error with a retry button (no fake signed-in state).
// =============================================================================

import { useCallback, useEffect, useState } from 'react';
import { ApiError, mailApi, SessionInfo } from '../services/mailApi';
import { buildSigninUrl, clearAuthReturnMarker, isAuthReturnUrl } from '../services/authRedirect';

export { buildSigninUrl } from '../services/authRedirect';

export type SessionState =
  | { status: 'loading' }
  | { status: 'redirecting' }
  | { status: 'ready'; info: SessionInfo }
  | { status: 'error'; message: string };

function clearReturnMarker(): void {
  const current = window.location.href;
  const clean = clearAuthReturnMarker(current);
  if (clean !== current) window.history.replaceState(window.history.state, '', clean);
}

export function useSession() {
  const [state, setState] = useState<SessionState>({ status: 'loading' });

  const load = useCallback(() => {
    setState({ status: 'loading' });
    mailApi
      .getSession()
      .then((info) => {
        clearReturnMarker();
        setState({ status: 'ready', info });
      })
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 401 && err.signinUrl) {
          if (isAuthReturnUrl(window.location.href)) {
            clearReturnMarker();
            setState({
              status: 'error',
              message:
                'Accounts sent you back to Mail, but Mail could not verify your sign-in. The return link worked; the Accounts session cookie may be missing, expired, or not shared with Mail. Try again in the same browser. If it repeats, ask the admin to check the shared cookie settings.',
            });
            return;
          }
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
