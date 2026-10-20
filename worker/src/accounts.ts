// =============================================================================
// Account switcher: multiple signed-in Gothwad accounts, Google style.
//
// Mail is NOT the source of truth here. Accounts owns the list of signed-in
// accounts (one session cookie per account plus an "active" pointer). Mail only:
//
//   1. proxies three calls to Accounts with the browser's cookie, and forwards
//      the rotated Set-Cookie headers back (session.ts already does this for the
//      session check, so we reuse that path),
//   2. adds the per-account unread count from Mail's own D1 table.
//
// Why a proxy instead of calling Accounts from the browser: no CORS, no
// third-party cookies, and the Worker can keep the "401 only means signed out"
// rule that stops the sign-in chooser from looping.
//
// Why the switcher is invisible when Accounts has not deployed the feature:
// Accounts answers 404, we return `unsupported: true`, and the UI hides the
// switcher. Mail ships safely first and lights up on its own afterwards.
// =============================================================================

import type { Config, Env } from './config';
import { Db } from './db';
import { HttpError } from './http';
import { deriveEmail, keepAccountsCookies, normalizeUsername, type Session } from './session';

export interface AccountSummary {
  /** Accounts' slot id ("a".."f"). Opaque to Mail, only echoed back. */
  id: string;
  username: string;
  name: string | null;
  email: string;
  lastUsedAt: string | null;
}

export interface AccountsPayload {
  activeId: string | null;
  accounts: AccountSummary[];
  /** username -> unread inbox count, from Mail's D1. */
  unread: Record<string, number>;
  /** True when Accounts does not have the multi-account API yet (404). */
  unsupported?: true;
}

/** Accounts allows a handful of slots per browser; keep the cap the same. */
const MAX_ACCOUNTS = 6;
/** Slot ids are single lowercase letters. Anything else is not ours. */
const SLOT_RE = /^[a-z]$/;
const UPSTREAM_TIMEOUT_MS = 5000;

const ACCOUNTS_MISSING = 'mail_accounts_unsupported';

export function parseSlotId(raw: unknown): string {
  const id = typeof raw === 'string' ? raw.trim() : '';
  if (!SLOT_RE.test(id)) {
    throw new HttpError(400, 'bad_request', 'Unknown account.');
  }
  return id;
}

interface UpstreamBody {
  activeId?: unknown;
  accounts?: unknown;
}

/** Shape coming from Accounts inside the `accounts` array. */
interface UpstreamAccount {
  id?: unknown;
  username?: unknown;
  firstName?: unknown;
  lastName?: unknown;
  lastUsedAt?: unknown;
}

/**
 * One call to Accounts. Everything Mail cannot use is turned into either a 401
 * (only when Accounts really said "not signed in") or a 503. Never a 401 for a
 * broken handoff, because the browser redirects to Accounts on a 401.
 */
async function callAccounts(
  request: Request,
  config: Config,
  path: string,
  init: { method?: string; body?: unknown } = {}
): Promise<Response> {
  const cookie = request.headers.get('cookie');
  if (!cookie) {
    // Bearer-only callers (native clients) have no browser cookie jar, so the
    // account list is simply not available to them.
    throw new HttpError(503, ACCOUNTS_MISSING, 'The account switcher needs a browser session.');
  }

  const headers: Record<string, string> = { cookie, accept: 'application/json' };
  if (init.body !== undefined) headers['content-type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(`${config.authHubUrl}${path}`, {
      method: init.method || 'GET',
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      redirect: 'manual', // a redirect here means a routing problem, not a session
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch {
    console.warn('accounts_switch_failed code=auth_unavailable status=none');
    throw new HttpError(503, 'auth_unavailable', 'Accounts is not reachable right now.');
  }

  // Accounts rotates session cookies on every authenticated call. Dropping
  // them would sign the browser out of Accounts, so always pass them on.
  keepAccountsCookies(request, res);

  if (res.status === 401 || res.status === 403) {
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

/** Maps Accounts' list body to what the Mail UI needs, dropping anything odd. */
function parseAccounts(body: UpstreamBody | null, config: Config): Omit<AccountsPayload, 'unread'> {
  const rawList = Array.isArray(body?.accounts) ? (body!.accounts as UpstreamAccount[]) : [];
  const activeId = typeof body?.activeId === 'string' && SLOT_RE.test(body.activeId) ? body.activeId : null;

  const accounts: AccountSummary[] = [];
  const seen = new Set<string>();
  for (const raw of rawList) {
    if (accounts.length >= MAX_ACCOUNTS) break;
    const id = typeof raw?.id === 'string' && SLOT_RE.test(raw.id) ? raw.id : null;
    const username = normalizeUsername(raw?.username);
    // An entry Mail cannot fully trust is skipped: a bad row must never make
    // the switcher show a mailbox that is not really signed in.
    if (!id || !username || seen.has(id)) continue;
    seen.add(id);
    const name =
      [raw.firstName, raw.lastName]
        .map((part) => (typeof part === 'string' ? part.trim() : ''))
        .filter(Boolean)
        .join(' ') || null;
    accounts.push({
      id,
      username,
      name,
      email: deriveEmail(username, config.appDomain),
      lastUsedAt: typeof raw.lastUsedAt === 'string' ? raw.lastUsedAt : null,
    });
  }

  return { activeId: accounts.some((a) => a.id === activeId) ? activeId : accounts[0]?.id ?? null, accounts };
}

/**
 * Unread inbox counts for the accounts in the list.
 *
 * Only usernames that Accounts just confirmed are queried, so this can never be
 * used to read another mailbox's counts. One grouped query, not one per account.
 */
async function unreadCounts(env: Env, usernames: string[]): Promise<Record<string, number>> {
  if (usernames.length === 0) return {};
  const unique = [...new Set(usernames)].slice(0, MAX_ACCOUNTS);
  const placeholders = unique.map(() => '?').join(', ');
  try {
    const db = await Db.from(env);
    const rows = await db.all<{ username: string; n: number }>(
      `SELECT to_username AS username, COUNT(*) AS n
         FROM mail_messages
        WHERE folder = 'inbox' AND is_read = 0 AND to_username IN (${placeholders})
        GROUP BY to_username`,
      ...unique
    );
    // Start at 0 for every account so the client never has to guess; the
    // grouped query only returns rows that actually have unread mail.
    const out: Record<string, number> = {};
    for (const username of unique) out[username] = 0;
    for (const row of rows) out[row.username] = Number(row.n ?? 0);
    return out;
  } catch {
    // A count is decoration. Never fail the switcher over it.
    return {};
  }
}

/** Full payload for the switcher: list from Accounts + counts from Mail. */
async function payloadFor(env: Env, config: Config, upstream: Response): Promise<AccountsPayload> {
  const body = (await upstream.json().catch(() => null)) as UpstreamBody | null;
  const parsed = parseAccounts(body, config);
  const unread = await unreadCounts(
    env,
    parsed.accounts.map((a) => a.username)
  );
  return { ...parsed, unread };
}

/** GET /api/mail/accounts */
export async function listAccounts(env: Env, request: Request, config: Config): Promise<AccountsPayload> {
  const res = await callAccounts(request, config, '/api/auth/accounts');
  if (res.status === 404) {
    // Accounts has not shipped the multi-account API yet. Not an error: the UI
    // hides the switcher and Mail behaves exactly as it did before.
    return { activeId: null, accounts: [], unread: {}, unsupported: true };
  }
  if (!res.ok) {
    console.warn(`accounts_switch_failed code=auth_unavailable status=${res.status}`);
    throw new HttpError(503, 'auth_unavailable', 'Accounts is not reachable right now.');
  }
  return payloadFor(env, config, res);
}

/** POST /api/mail/accounts/switch  { id } */
export async function switchAccount(
  env: Env,
  request: Request,
  config: Config,
  rawId: unknown
): Promise<AccountsPayload> {
  const id = parseSlotId(rawId);
  const res = await callAccounts(request, config, '/api/auth/switch', { method: 'POST', body: { id } });

  if (res.status === 404) {
    throw new HttpError(503, ACCOUNTS_MISSING, 'Switching accounts is not available yet.');
  }
  // 409 from Accounts: this browser has no usable session for that slot any
  // more. Pass it through so the UI can offer "sign in again" for that row.
  if (res.status === 409) {
    throw new HttpError(409, 'account_not_signed_in', 'That account is signed out. Sign in again.');
  }
  if (!res.ok) {
    throw new HttpError(503, 'auth_unavailable', 'Could not switch accounts right now.');
  }
  return payloadFor(env, config, res);
}

/** POST /api/mail/accounts/signout  { id } */
export async function signOutAccount(
  env: Env,
  request: Request,
  config: Config,
  rawId: unknown
): Promise<AccountsPayload> {
  const id = parseSlotId(rawId);
  const res = await callAccounts(request, config, `/api/auth/accounts/${encodeURIComponent(id)}/signout`, {
    method: 'POST',
  });

  if (res.status === 404) {
    throw new HttpError(503, ACCOUNTS_MISSING, 'Account switching is not available yet.');
  }
  if (!res.ok) {
    throw new HttpError(503, 'auth_unavailable', 'Could not sign that account out right now.');
  }
  return payloadFor(env, config, res);
}

/**
 * Where "Add another account" goes: the Accounts sign-in page in append mode.
 * Built from AUTH_SIGNIN_URL (the browser-facing host), never from the request,
 * so this cannot become an open redirect.
 */
export function addAccountUrl(config: Config, session: Session): string {
  const next = `${config.mailUrl}/`;
  const qs = new URLSearchParams({ choose: '1', add: '1', next });
  // `username` lets Accounts prefill or at least say which account is adding
  // another one; it is display-only there.
  qs.set('from', session.username);
  return `${config.authSigninUrl}/signin?${qs.toString()}`;
}

/** 302 to Accounts. A plain navigation, so no CORS and no fetch involved. */
export function addAccountResponse(config: Config, session: Session): Response {
  return new Response(null, {
    status: 302,
    headers: { location: addAccountUrl(config, session), 'cache-control': 'no-store' },
  });
}
