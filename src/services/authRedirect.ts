// The return marker lets Mail distinguish a first sign-in from an Accounts
// handoff that came back without a session, preventing an endless chooser loop.
export const AUTH_RETURN_PARAM = '__mail_auth_return';

/** Builds the Accounts sign-in URL and marks the Mail URL for the return check. */
export function buildSigninUrl(signinBase: string, returnTo: string): string {
  const target = new URL(returnTo);
  target.searchParams.set(AUTH_RETURN_PARAM, '1');

  const signin = new URL(signinBase);
  signin.searchParams.set('next', target.toString());
  return signin.toString();
}

export function isAuthReturnUrl(href: string): boolean {
  try {
    return new URL(href).searchParams.get(AUTH_RETURN_PARAM) === '1';
  } catch {
    return false;
  }
}

/** Removes the one-time marker without disturbing the Mail URL or its state. */
export function clearAuthReturnMarker(href: string): string {
  try {
    const url = new URL(href);
    if (!url.searchParams.has(AUTH_RETURN_PARAM)) return href;
    url.searchParams.delete(AUTH_RETURN_PARAM);
    return url.toString();
  } catch {
    return href;
  }
}
