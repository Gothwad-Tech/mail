// =============================================================================
// Session resolution: "who is this request for?"
//
// Source of truth = Gothwad Accounts (AUTH_HUB_URL). Mail never stores
// passwords and never mints its own login.
//
//  1. Cookie path (normal web use): forward the browser's Cookie header to
//     GET {AUTH_HUB_URL}/api/auth/me. Accounts sets the cookies on
//     .gothwadtech.com, so they reach this Worker on mail.gothwadtech.com.
//  2. Bearer path (future native/iframe clients): GET
//     {AUTH_HUB_URL}/api/oauth/userinfo with the access token.
//
// AUTH_HUB_URL must be a host that reaches the Accounts Worker for a
// server-to-server call (Accounts' Custom Domain, e.g. api.gothwadtech.com).
// AUTH_SIGNIN_URL is used only for the browser-facing sign-in link; see
// signinBaseUrl() below and the note in config.ts.
//
// Email is DERIVED here as username@APP_DOMAIN (Accounts stores username only).
//
// Status rule (see docs/MAIL.md, "If Accounts keeps showing the chooser"):
//   401/403 from Accounts = really signed out -> Mail 401 + signinUrl.
//   Anything else that Mail cannot read (3xx, HTML, missing authenticated flag,
//   unusable username, 5xx, timeout) = 503 with its own code, NEVER a 401.
//   A 401 must mean "signed out", otherwise the browser bounces back to the
//   Accounts chooser in a loop.
// =============================================================================

import type { Config } from './config';
import { HttpError } from './http';

// Codes Mail returns when the Accounts handoff itself is broken. The web app
// shows a retry message for these and must never redirect to Accounts.
export const AUTH_UNAVAILABLE = 'auth_unavailable';
export const ACCOUNTS_UNEXPECTED_RESPONSE = 'accounts_unexpected_response';
export const ACCOUNTS_USER_INVALID = 'accounts_user_invalid';

export interface Session {
  username: string;
  email: string;
  name: string | null;
  source: 'cookie' | 'bearer' | 'dev';
}

// Username rule: lowercase letters, digits, dot, dash, underscore. This keeps
// the derived email address safe to put in SQL filters and in the From header.
const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export function normalizeUsername(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const u = raw.trim().toLowerCase();
  return USERNAME_RE.test(u) ? u : null;
}

export function deriveEmail(username: string, appDomain: string): string {
  return `${username}@${appDomain}`;
}

const UPSTREAM_TIMEOUT_MS = 5000;

// Accounts can rotate the refresh token on /auth/me and send new Set-Cookie
// headers. If we dropped them, the browser would keep a revoked refresh token
// and the user would be signed out of Accounts everywhere. So we remember the
// Accounts cookies per request, and handleRequest copies them to the browser.
const upstreamCookies = new WeakMap<Request, string[]>();

/** Returns (and clears) the Accounts cookies to pass on to the browser. */
export function takeUpstreamCookies(request: Request): string[] {
  const list = upstreamCookies.get(request) ?? [];
  upstreamCookies.delete(request);
  return list;
}

/** Re-exported for the account switcher (see accounts.ts): it must forward the
 * rotated Accounts cookies exactly like the session check does. */
export function keepAccountsCookies(request: Request, res: Response): void {
  // Only Accounts' own gothwad_* cookies. Anything else from upstream is ignored.
  // getSetCookie() gives each Set-Cookie separately (get() would join them).
  // Our worker type lib does not declare it yet, so we cast.
  const h = res.headers as Headers & { getSetCookie?: () => string[] };
  const all = h.getSetCookie ? h.getSetCookie() : [];
  const cookies = all.filter((c) => /^gothwad_[a-z_]+=/i.test(c));
  if (cookies.length > 0) upstreamCookies.set(request, cookies);
}

export async function resolveSession(request: Request, config: Config): Promise<Session | null> {
  // Dev-only bypass for local testing without Accounts. Never active in production.
  if (config.devAuthUsername) {
    const username = normalizeUsername(config.devAuthUsername);
    if (!username) throw new HttpError(500, 'bad_dev_user', 'DEV_AUTH_USERNAME is invalid.');
    return { username, email: deriveEmail(username, config.appDomain), name: null, source: 'dev' };
  }

  const cookie = request.headers.get('cookie');
  const auth = request.headers.get('authorization');

  if (auth && /^bearer\s+/i.test(auth)) {
    return resolveBearer(auth, config);
  }
  if (cookie) {
    return resolveCookie(request, cookie, config);
  }
  return null;
}

// Shape of Accounts' /api/auth/me body that Mail relies on. Everything is
// optional here until it has been checked: a misrouted /api/* answers with
// HTML, not with this.
interface AccountsMeBody {
  authenticated?: boolean;
  user?: { username?: unknown; first_name?: unknown; last_name?: unknown };
}

const AUTH_UNAVAILABLE_MESSAGE = 'Accounts is not reachable right now.';
const ACCOUNTS_UNEXPECTED_MESSAGE =
  'Accounts did not answer with a session Mail can read. This is an Accounts routing problem, not a signed-out user. Try again in a minute, or contact the admin.';
const ACCOUNTS_USER_INVALID_MESSAGE =
  'Your Gothwad Account is signed in, but Mail could not read your username. Try again in a minute, or contact the admin.';

async function resolveCookie(request: Request, cookie: string, config: Config): Promise<Session | null> {
  const res = await upstream(`${config.authHubUrl}/api/auth/me`, { cookie, accept: 'application/json' });
  keepAccountsCookies(request, res);

  // Only 401/403 means Accounts checked and the user really is signed out.
  if (isSignedOut(res.status)) return null;
  assertAccountsUsable(res);

  const body = (await res.json().catch(() => null)) as AccountsMeBody | null;
  // A 200 that is not Mail's JSON (e.g. the HTML a misrouted /api/* serves) or
  // that has no authenticated flag is a broken handoff, not a signed-out user.
  if (!body || typeof body.authenticated !== 'boolean') {
    throw unexpectedResponseError(res);
  }
  if (!body.authenticated) return null;

  const username = normalizeUsername(body.user?.username);
  if (!username) {
    // Accounts says the user IS signed in. Mail just cannot read the username,
    // so a 401 here would only restart the chooser loop. 503 with its own code.
    warnUpstreamFailure(ACCOUNTS_USER_INVALID, res);
    throw new HttpError(503, ACCOUNTS_USER_INVALID, ACCOUNTS_USER_INVALID_MESSAGE);
  }

  const name = [body.user?.first_name, body.user?.last_name].filter(Boolean).join(' ').trim() || null;
  return { username, email: deriveEmail(username, config.appDomain), name, source: 'cookie' };
}

async function resolveBearer(authHeader: string, config: Config): Promise<Session | null> {
  const res = await upstream(`${config.authHubUrl}/api/oauth/userinfo`, {
    authorization: authHeader,
    accept: 'application/json',
  });
  // Same rule as the cookie path: a real 401/403 is signed out, everything else
  // Mail cannot read is an upstream failure and gets a 503.
  if (isSignedOut(res.status)) return null;
  assertAccountsUsable(res);

  const body = (await res.json().catch(() => null)) as {
    preferred_username?: unknown;
    name?: string;
  } | null;
  if (!body || typeof body !== 'object') {
    throw unexpectedResponseError(res);
  }
  const username = normalizeUsername(body.preferred_username);
  if (!username) {
    warnUpstreamFailure(ACCOUNTS_USER_INVALID, res);
    throw new HttpError(503, ACCOUNTS_USER_INVALID, ACCOUNTS_USER_INVALID_MESSAGE);
  }
  return { username, email: deriveEmail(username, config.appDomain), name: body.name ?? null, source: 'bearer' };
}

/** 401/403 only: Accounts looked at the credentials and said "not signed in". */
function isSignedOut(status: number): boolean {
  return status === 401 || status === 403;
}

/**
 * Turns an Accounts answer Mail cannot use into a 503. Callers handle the
 * signed-out cases first, so reaching here means Mail does not know who the
 * user is: that must never be reported to the browser as a 401.
 */
function assertAccountsUsable(res: Response): void {
  // We always send redirect: 'manual'. A 3xx therefore means the request never
  // reached the Accounts Worker (/api/* route missing) or Accounts is
  // redirecting. Following it would also hand the user's cookies to the host
  // the redirect points at.
  if (res.status >= 300 && res.status < 400) {
    throw unexpectedResponseError(res);
  }
  if (!res.ok) {
    warnUpstreamFailure(AUTH_UNAVAILABLE, res);
    throw new HttpError(503, AUTH_UNAVAILABLE, AUTH_UNAVAILABLE_MESSAGE);
  }
}

/**
 * The 503 `accounts_unexpected_response`, with what Accounts actually answered.
 * Status and content-type only: enough for the browser's DevTools to show
 * "Accounts answered 200 text/html" without opening the Worker log. The
 * upstream body and its Set-Cookie/token values never leave the Worker.
 */
function unexpectedResponseError(res: Response): HttpError {
  warnUpstreamFailure(ACCOUNTS_UNEXPECTED_RESPONSE, res);
  return new HttpError(503, ACCOUNTS_UNEXPECTED_RESPONSE, ACCOUNTS_UNEXPECTED_MESSAGE, {
    upstreamStatus: res.status,
    upstreamContentType: res.headers.get('content-type') || null,
  });
}

/**
 * One warn line per failed upstream check: our error code, the upstream status
 * and its content-type. That is enough to tell the branches apart in the Worker
 * log. Never log the cookie, tokens, or the response body.
 */
function warnUpstreamFailure(code: string, res: Response | null): void {
  const status = res ? String(res.status) : 'none';
  const contentType = res?.headers.get('content-type') || 'none';
  console.warn(`accounts_check_failed code=${code} status=${status} content-type=${contentType}`);
}

async function upstream(url: string, headers: Record<string, string>): Promise<Response> {
  try {
    return await fetch(url, {
      method: 'GET',
      headers,
      redirect: 'manual', // a redirect here is an Accounts routing problem; do not follow it
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch {
    // Network error or timeout: there is no upstream status to report.
    warnUpstreamFailure(AUTH_UNAVAILABLE, null);
    throw new HttpError(503, AUTH_UNAVAILABLE, AUTH_UNAVAILABLE_MESSAGE);
  }
}

/**
 * Where to send an unauthenticated browser. The browser appends its own ?next=.
 *
 * This is a BROWSER link, not a server-side call, so it uses AUTH_SIGNIN_URL
 * (the Accounts host people sign in on). AUTH_HUB_URL is the server-to-server
 * host; sending users there would work only by accident, and on a Custom
 * Domain such as api.gothwadtech.com it would not be the sign-in page.
 */
export function signinBaseUrl(config: Config): string {
  return `${config.authSigninUrl}/signin?choose=1`;
}
