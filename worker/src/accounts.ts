// =============================================================================
// Account switcher, Google style: Mail's proxy in front of Gothwad Accounts.
//
// Accounts owns the list (one session cookie per slot `a`..`f`, plus the browser
// "active" pointer). Mail never stores another account's credentials. It only:
//
//   1. proxies the calls with the browser's cookies AND the tab's
//      `X-Gothwad-Authuser` selector, so /u/0 and /u/1 tabs stay independent,
//   2. forwards every rotated Set-Cookie (via session.ts) — dropping them would
//      sign the browser out of Accounts,
//   3. adds the per-account unread counts from Mail's own D1.
//
// Upstream contract (live, Accounts v2.3 on AUTH_HUB_URL):
//   GET  /api/auth/accounts                 { activeId, authuser, accounts }
//   POST /api/auth/switch  {id}|{authuser}  { ok, activeId, authuser, user, accounts }
//   POST /api/auth/accounts/:id/signout     { ok, signedOutAll, activeId, authuser, accounts }
//   GET  /api/auth/switch?authuser=&next=   first-party redirect (browser only)
//
// The two POSTs require an `Origin` header upstream (CSRF), so the browser's
// origin is forwarded as-is; `assertSafeWrite` has already checked it.
// =============================================================================

import type { Config, Env } from './config';
import { HttpError } from './http';
import { normalizeAuthUser } from './authuser';
import { keepAccountsCookies, type Session } from './session';
import { parseAccounts, unreadCounts, type PublicAccount } from './accountList';

export interface AccountsPayload {
  activeId: string | null;
  /** Index of the active account (0..5) — the /u/<n>/ the app should show. */
  authuser: number | null;
  accounts: PublicAccount[];
  /** username -> unread inbox count, from Mail's D1. */
  unread: Record<string, number>;
  /** Accounts does not have the multi-account API (404): hide the switcher. */
  unsupported?: true;
}

const UPSTREAM_TIMEOUT_MS = 5000;
const ACCOUNTS_MISSING = 'mail_accounts_unsupported';

/** True when the body names an account by slot id or by authuser index. */
export interface SwitchRequest {
  id?: string;
  /** Numeric index, exactly as Accounts' JSON contract expects it. */
  authuser?: number;
}

export function parseSwitchRequest(raw: unknown): SwitchRequest {
  const body = (raw ?? {}) as Record<string, unknown>;
  const id = normalizeAuthUser(body.id) ?? undefined;
  const rawAuthuser = normalizeAuthUser(body.authuser) ?? undefined;
  // Accounts' JSON body takes an index, not the string form used in URLs.
  const authuser = rawAuthuser && /^\d$/.test(rawAuthuser) ? Number(rawAuthuser) : undefined;
  // `id` must be a slot letter; a numeric id would be a client bug we do not
  // want to forward as a slot value.
  if (body.id !== undefined && (!id || !/^[a-f]$/.test(id))) {
    throw new HttpError(400, 'bad_request', 'Unknown account.');
  }
  if (!id && authuser === undefined) {
    throw new HttpError(400, 'bad_request', 'Send { id } or { authuser }.');
  }
  return { ...(id ? { id } : {}), ...(authuser !== undefined ? { authuser } : {}) };
}

/** The browser origin (needed by Accounts' CSRF check) or our own mail URL. */
function browserOrigin(request: Request, config: Config): string {
  return request.headers.get('origin') || config.mailUrl;
}

interface UpstreamOptions {
  method?: string;
  body?: unknown;
  selector?: string | null;
}

/**
 * One call to Accounts. Every answer Mail cannot use becomes a 401 (only when
 * Accounts really said "signed out") or a 503 — never a fake sign-out.
 */
async function callAccounts(
  request: Request,
  config: Config,
  path: string,
  opts: UpstreamOptions = {}
): Promise<Response> {
  const cookie = request.headers.get('cookie');
  if (!cookie) {
    throw new HttpError(503, ACCOUNTS_MISSING, 'The account switcher needs a browser session.');
  }

  const headers: Record<string, string> = {
    cookie,
    accept: 'application/json',
    origin: browserOrigin(request, config),
  };
  if (opts.selector) headers['x-gothwad-authuser'] = opts.selector;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(`${config.authHubUrl}${path}`, {
      method: opts.method || 'GET',
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      redirect: 'manual', // a redirect here is a routing problem, not a session
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch {
    console.warn('accounts_switch_failed code=auth_unavailable status=none');
    throw new HttpError(503, 'auth_unavailable', 'Accounts is not reachable right now.');
  }

  // Rotated slot/refresh cookies must reach the browser, always.
  keepAccountsCookies(request, res);

  if (res.status === 401 || res.status === 403) {
    // 403 upstream is its CSRF/origin check. Our own writes are checked before
    // this call, so a 403 here means the deployment's origins disagree.
    if (res.status === 403) {
      console.warn('accounts_switch_failed code=bad_origin status=403');
      throw new HttpError(403, 'bad_origin', 'Accounts rejected the request origin.');
    }
    throw new HttpError(401, 'unauthenticated', 'Please sign in.', {
      signinUrl: `${config.authSigninUrl}/signin?choose=1`,
    });
  }

  if (res.status >= 300 && res.status < 400) {
    console.warn(`accounts_switch_failed code=accounts_unexpected_response status=${res.status}`);
    throw new HttpError(503, 'accounts_unexpected_response', 'Accounts did not answer with a session Mail can read.');
  }

  return res;
}

/** Builds the payload the UI needs: list from Accounts + counts from Mail. */
async function payloadFor(
  env: Env,
  config: Config,
  upstream: Response,
  selector?: string | null
): Promise<AccountsPayload> {
  const body = (await upstream.json().catch(() => null)) as {
    activeId?: unknown;
    authuser?: unknown;
    accounts?: unknown;
  } | null;

  const accounts = parseAccounts(body?.accounts, config, (n) => `${config.authSigninUrl}/u/${n}/me`);
  const rawActive = typeof body?.activeId === 'string' ? body.activeId.toLowerCase() : null;
  const activeId = rawActive && accounts.some((a) => a.id === rawActive) ? rawActive : accounts[0]?.id ?? null;
  const upstreamIndex = typeof body?.authuser === 'number' ? body.authuser : 0;
  const matched = accounts.findIndex((a) => a.id === activeId);
  let authuser = matched >= 0 ? matched : Math.min(Math.max(upstreamIndex, 0), Math.max(accounts.length - 1, 0));
  // This TAB's /u/<n>/ wins over the browser-wide active account: /u/1 must not
  // render account 0 just because another tab made `a` active.
  if (selector && /^\d$/.test(selector) && Number(selector) < accounts.length) {
    authuser = Number(selector);
  }
  const tabActiveId = accounts[authuser]?.id ?? activeId;

  // A failed count shows no pills at all (`null`) rather than claiming zeros.
  const unread = await unreadCounts(
    env,
    accounts.map((a) => a.username)
  );
  return { activeId: tabActiveId, authuser, accounts, unread: unread ?? {} };
}

/** GET /api/mail/accounts */
export async function listAccounts(
  env: Env,
  request: Request,
  config: Config,
  selector: string | null
): Promise<AccountsPayload> {
  const res = await callAccounts(request, config, '/api/auth/accounts', { selector });
  if (res.status === 404) {
    // Accounts has not shipped the multi-account API: the UI hides the switcher
    // and Mail behaves exactly as before. This keeps the deploy order free.
    return { activeId: null, authuser: null, accounts: [], unread: {}, unsupported: true };
  }
  if (!res.ok) {
    console.warn(`accounts_switch_failed code=auth_unavailable status=${res.status}`);
    throw new HttpError(503, 'auth_unavailable', 'Accounts is not reachable right now.');
  }
  return payloadFor(env, config, res, selector);
}

/** POST /api/mail/accounts/switch  { id }  or  { authuser } */
export async function switchAccount(
  env: Env,
  request: Request,
  config: Config,
  body: unknown,
  selector: string | null
): Promise<AccountsPayload> {
  const target = parseSwitchRequest(body);
  const upstream = await callAccounts(request, config, '/api/auth/switch', {
    method: 'POST',
    body: target,
    selector,
  });

  if (upstream.status === 404) {
    throw new HttpError(503, ACCOUNTS_MISSING, 'Switching accounts is not available yet.');
  }
  // 409: that slot's session is gone (or was revoked in another tab). Pass it
  // through so the UI can offer "sign in again" for that one account.
  if (upstream.status === 409) {
    // Give the UI the exact re-auth link for that slot, so it can send the user
    // straight to Accounts instead of guessing.
    const index = typeof target.authuser === 'number' ? target.authuser : null;
    throw new HttpError(
      409,
      'account_not_signed_in',
      'That account is signed out. Sign in again.',
      index === null ? {} : { authuser: index, reauthUrl: reauthUrl(config, index) }
    );
  }
  if (!upstream.ok) {
    throw new HttpError(503, 'auth_unavailable', 'Could not switch accounts right now.');
  }
  return payloadFor(env, config, upstream);
}

/**
 * POST /api/mail/accounts/signout-all
 *
 * Accounts' `/auth/signout` revokes every slot cookie this browser holds. Mail
 * only forwards it: after this the next `/api/session` is a 401, which is the
 * single place that decides where the browser goes.
 */
export async function signOutAllAccounts(
  request: Request,
  config: Config,
  selector: string | null
): Promise<{ ok: true; signedOutAll: true }> {
  const upstream = await callAccounts(request, config, '/api/auth/signout', { method: 'POST', selector });
  if (upstream.status === 404) {
    throw new HttpError(503, ACCOUNTS_MISSING, 'Account switching is not available yet.');
  }
  if (!upstream.ok) {
    throw new HttpError(503, 'auth_unavailable', 'Could not sign out right now.');
  }
  return { ok: true, signedOutAll: true };
}

/** POST /api/mail/accounts/signout  { id } */
export async function signOutAccount(
  env: Env,
  request: Request,
  config: Config,
  body: unknown,
  selector: string | null
): Promise<AccountsPayload & { signedOutAll: boolean }> {
  const { id } = parseSwitchRequest(body);
  if (!id) throw new HttpError(400, 'bad_request', 'Send { id }.');

  const upstream = await callAccounts(request, config, `/api/auth/accounts/${encodeURIComponent(id)}/signout`, {
    method: 'POST',
    selector,
  });

  if (upstream.status === 404) {
    throw new HttpError(503, ACCOUNTS_MISSING, 'Account switching is not available yet.');
  }
  if (!upstream.ok) {
    throw new HttpError(503, 'auth_unavailable', 'Could not sign that account out right now.');
  }

  const bodyUpstream = (await upstream.json().catch(() => null)) as { signedOutAll?: unknown } | null;
  const payload = await payloadFor(
    env,
    config,
    new Response(JSON.stringify(bodyUpstream), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  );
  return { ...payload, signedOutAll: payload.accounts.length === 0 || bodyUpstream?.signedOutAll === true };
}

/**
 * Where "Add another account" goes: Accounts' sign-in page in append mode, with
 * Google's parameters and a `next` back to the new slot's URL.
 *
 * Built from AUTH_SIGNIN_URL and MAIL_URL (config), never from the request, so
 * it cannot become an open redirect.
 */
export function addAccountUrl(config: Config, session: Session, nextIndex?: number): string {
  const index =
    typeof nextIndex === 'number' && nextIndex >= 0
      ? nextIndex
      : Math.min(session.accounts.length, 5);
  const next = `${config.mailUrl}/u/${index}/`;
  const qs = new URLSearchParams({ add: '1', login: '1', authuser: String(index), next });
  return `${config.authSigninUrl}/signin?${qs.toString()}`;
}

/** 302 to Accounts. A plain navigation, so no CORS and no fetch involved. */
export function addAccountResponse(config: Config, session: Session, nextIndex?: number): Response {
  return new Response(null, {
    status: 302,
    headers: { location: addAccountUrl(config, session, nextIndex), 'cache-control': 'no-store' },
  });
}

/**
 * Re-auth link for a slot whose session is gone (409 during a switch):
 * Accounts' sign-in with `login=1` and this slot's index.
 */
export function reauthUrl(config: Config, authuser: number, username?: string): string {
  const qs = new URLSearchParams({
    login: '1',
    authuser: String(authuser),
    next: `${config.mailUrl}/u/${authuser}/`,
  });
  if (username) qs.set('username', username);
  return `${config.authSigninUrl}/signin?${qs.toString()}`;
}
