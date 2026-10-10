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
// Email is DERIVED here as username@APP_DOMAIN (Accounts stores username only).
// =============================================================================

import type { Config } from './config';
import { HttpError } from './http';

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

function keepAccountsCookies(request: Request, res: Response): void {
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

async function resolveCookie(request: Request, cookie: string, config: Config): Promise<Session | null> {
  const res = await upstream(`${config.authHubUrl}/api/auth/me`, { cookie, accept: 'application/json' });
  keepAccountsCookies(request, res);
  if (isUnauthenticated(res.status)) return null;
  if (!res.ok) throw new HttpError(503, 'auth_unavailable', 'Accounts is not reachable right now.');

  const body = (await res.json().catch(() => null)) as {
    authenticated?: boolean;
    user?: { username?: string; first_name?: string; last_name?: string };
  } | null;
  if (!body?.authenticated) return null;

  const username = normalizeUsername(body.user?.username);
  if (!username) return null;

  const name = [body.user?.first_name, body.user?.last_name].filter(Boolean).join(' ').trim() || null;
  return { username, email: deriveEmail(username, config.appDomain), name, source: 'cookie' };
}

async function resolveBearer(authHeader: string, config: Config): Promise<Session | null> {
  const res = await upstream(`${config.authHubUrl}/api/oauth/userinfo`, {
    authorization: authHeader,
    accept: 'application/json',
  });
  if (isUnauthenticated(res.status)) return null;
  if (!res.ok) throw new HttpError(503, 'auth_unavailable', 'Accounts is not reachable right now.');

  const body = (await res.json().catch(() => null)) as {
    preferred_username?: string;
    name?: string;
  } | null;
  const username = normalizeUsername(body?.preferred_username);
  if (!username) return null;
  return { username, email: deriveEmail(username, config.appDomain), name: body?.name ?? null, source: 'bearer' };
}

// 3xx counts as "not signed in": we never follow redirects to Accounts pages.
function isUnauthenticated(status: number): boolean {
  return status === 401 || status === 403 || (status >= 300 && status < 400);
}

async function upstream(url: string, headers: Record<string, string>): Promise<Response> {
  try {
    return await fetch(url, {
      method: 'GET',
      headers,
      redirect: 'manual', // a redirect here would mean "not signed in"; do not follow it
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch {
    throw new HttpError(503, 'auth_unavailable', 'Accounts is not reachable right now.');
  }
}

/** Where to send an unauthenticated browser. The browser appends its own ?next=. */
export function signinBaseUrl(config: Config): string {
  return `${config.authHubUrl}/signin?choose=1`;
}
