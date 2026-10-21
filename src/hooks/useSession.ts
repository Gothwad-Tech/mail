// =============================================================================
// Session hook: asks the Mail Worker "who is signed in?" once on load.
//
// - 200 -> ready (we have the user + limits).
// - 401 + signinUrl -> send the browser to Accounts with ?next= back to this
//          Mail page. If that return still gets 401, show an error instead of
//          looping through the chooser forever.
// - 503 -> the Gothwad Account is signed in but Mail could not read it (or
//          Accounts is down). A 503 must NEVER redirect: the chooser would just
//          come back. The screen shows the reason with a Retry button.
// - other -> show an error with a retry button (no fake signed-in state).
// =============================================================================

import { useCallback, useEffect, useState } from 'react';
import { API_ERROR, ApiError, mailApi, SessionInfo, type AccountSummary } from '../services/mailApi';
import { buildSigninUrl, clearAuthReturnMarker, isAuthReturnUrl } from '../services/authRedirect';
import { normalizeAuthUserUrl, onUrlAccountChange } from '../services/authuser';

export { buildSigninUrl } from '../services/authRedirect';

export type SessionState =
  | { status: 'loading' }
  | { status: 'redirecting' }
  | { status: 'ready'; info: SessionInfo }
  | { status: 'error'; message: string };

const RETURNED_WITHOUT_SESSION_MESSAGE =
  'Accounts sent you back to Mail, but Mail could not verify your sign-in. The return link worked; the Accounts session cookie may be missing, expired, or not shared with Mail. Try again in the same browser. If it repeats, ask the admin to check the shared cookie settings.';

// A 503 with these codes is NOT an expired cookie: the account is signed in and
// Mail could not read the profile from Accounts. Keep the wording about that.
const ACCOUNTS_PROFILE_MESSAGE =
  'Your Gothwad Account is signed in, but Mail could not load your profile. Try again in a minute, or contact the admin.';

/** Message the session error screen shows for a failed /api/session call. */
export function sessionErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 503 && (err.code === API_ERROR.accountsUserInvalid || err.code === API_ERROR.accountsUnexpectedResponse)) {
      return ACCOUNTS_PROFILE_MESSAGE;
    }
    // A 401 without a signinUrl means the Worker cannot build the sign-in link.
    if (err.status === 401) return 'Sign-in is not configured for this Worker yet.';
    return err.message;
  }
  return err instanceof Error ? err.message : 'Could not check your session.';
}

export type SessionFailure =
  | { kind: 'redirect'; signinUrl: string }
  | { kind: 'return-error'; message: string }
  | { kind: 'error'; message: string };

/**
 * Decides what a failed /api/session call means.
 *
 * Only a 401 WITH a signinUrl may start the Accounts round-trip: that is the one
 * answer that really means "this browser is signed out". Everything else (any
 * 503 code, a network error) is shown locally with Retry, so a broken Accounts
 * answer can neither hide the mail nor loop the chooser.
 */
export function classifySessionFailure(err: unknown, isAccountsReturn: boolean): SessionFailure {
  if (err instanceof ApiError && err.status === 401 && err.signinUrl) {
    // Already came back from Accounts once: explain instead of going again.
    if (isAccountsReturn) return { kind: 'return-error', message: RETURNED_WITHOUT_SESSION_MESSAGE };
    return { kind: 'redirect', signinUrl: err.signinUrl };
  }
  return { kind: 'error', message: sessionErrorMessage(err) };
}

function clearReturnMarker(): void {
  const current = window.location.href;
  const clean = clearAuthReturnMarker(current);
  if (clean !== current) window.history.replaceState(window.history.state, '', clean);
}

export function useSession() {
  const [state, setState] = useState<SessionState>({ status: 'loading' });

  /**
   * `silent` re-checks the session without the full-screen loading state.
   * Used after switching accounts: the mailbox is about to be replaced, so
   * flashing "Checking your account…" over the whole app looks like a reload.
   */
  const load = useCallback((opts: { silent?: boolean } = {}) => {
    // `/mail/u/1/#sent`, `/?authuser=1`, `/?u=1` all become /u/1/#sent before
    // the first fetch, so every later request and every refresh uses the same
    // canonical URL.
    normalizeAuthUserUrl();
    if (!opts.silent) setState({ status: 'loading' });
    mailApi
      .getSession()
      .then((info) => {
        clearReturnMarker();
        setState({ status: 'ready', info });
      })
      .catch((err: unknown) => {
        const failure = classifySessionFailure(err, isAuthReturnUrl(window.location.href));
        if (failure.kind === 'redirect') {
          setState({ status: 'redirecting' });
          window.location.replace(buildSigninUrl(failure.signinUrl, window.location.href));
          return;
        }
        // The one-time return marker is only cleared for the "came back without
        // a session" case; a retry after a 503 can still succeed.
        if (failure.kind === 'return-error') clearReturnMarker();
        setState({ status: 'error', message: failure.message });
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * Applies an account straight from the switcher list: no network, no reload.
   * The URL has already been pushed to /u/<n>/, so the provider remounts with
   * that account's cached mailbox in the same frame (<16ms). The background
   * switch call then confirms it and rotates the cookies.
   */
  const applyAccount = useCallback((account: AccountSummary, all: AccountSummary[], unread: Record<string, number>) => {
    setState((prev) => {
      if (prev.status !== 'ready') return prev;
      return {
        status: 'ready',
        info: {
          ...prev.info,
          user: { username: account.username, email: account.email, name: account.name },
          authuser: account.authuser,
          activeId: account.id,
          accounts: all,
          unread,
          accountUrl: account.accountUrl,
        },
      };
    });
  }, []);

  /** Re-read the session after the active account changed. */
  const refresh = useCallback(async () => {
    try {
      const info = await mailApi.getSession();
      setState({ status: 'ready', info });
    } catch (err) {
      const failure = classifySessionFailure(err, isAuthReturnUrl(window.location.href));
      if (failure.kind === 'redirect') {
        setState({ status: 'redirecting' });
        window.location.replace(buildSigninUrl(failure.signinUrl, window.location.href));
        return;
      }
      setState({ status: 'error', message: failure.message });
    }
  }, []);

  /**
   * Back/Forward between /u/0/ and /u/1/. Reading a slot through the selector
   * does NOT change the browser-wide active account, so other tabs are safe.
   */
  useEffect(() => onUrlAccountChange(() => void refresh()), [refresh]);

  return { state, retry: load, refresh, applyAccount };
}
