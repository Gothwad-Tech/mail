// =============================================================================
// The `/api/session` payloads, split by what they cost.
//
// Identity is the only thing the app has to wait for: it proves who the browser
// is (Accounts) and carries everything the shell needs to render (user, this
// tab's account, the switcher list, the Accounts links). It costs one Accounts
// call and nothing else.
//
// Metadata is decoration: unread badges and the send quota both need D1. It is
// loaded separately (`GET /api/session/meta`) so a slow or failing database can
// neither delay nor block a verified shell. Unknown values stay `null` — never a
// zero, because "0 unread" is a claim and "not loaded yet" is not.
//
// The full `/api/session` response is unchanged for existing consumers; the app
// simply asks for the identity half first (`?meta=0`) and the metadata second.
// =============================================================================

import type { Config, Env } from './config';
import { Db } from './db';
import * as mail from './mail';
import { unreadCounts } from './accountList';
import type { Session } from './session';

/** Daily send cap plus what is left today. `null` means "not known yet". */
export interface SessionLimits {
  dailySendLimit: number;
  sendRemainingToday: number | null;
}

/** The deferred half of the session. */
export interface SessionMeta {
  /** Which account these numbers belong to, so a late answer can be dropped. */
  authuser: number;
  unread: Record<string, number> | null;
  limits: SessionLimits;
}

/** The identity half: no database, no optional work. */
export interface SessionIdentity {
  authenticated: true;
  user: {
    username: string;
    email: string;
    name: string | null;
    firstName: string;
    lastName: string;
    avatarUrl: string | null;
  };
  authuser: number;
  activeId: string | null;
  accounts: Session['accounts'];
  accountUrl: string;
  accountsWebOrigin: string;
  /** Always true here: this object only exists for a verified session. */
  meta: false;
  unread: null;
  limits: null;
}

/**
 * Origin the browser should load the shared account widget from.
 *
 * Production: the configured Accounts web host (AUTH_SIGNIN_URL). Development:
 * the host the browser actually used, because the local dev server serves the
 * widget stand-in at `/widget/account-menu.js` and Vite proxies that path. Using
 * the request host is safe: it is only a browser-side hint, it never becomes a
 * redirect target, and it only happens when ENVIRONMENT=development.
 */
export function accountsWebOriginFor(request: Request, config: Config): string {
  if (config.isProduction) return config.authSigninUrl;
  const host = request.headers.get('host');
  if (!host || !/^[a-z0-9.-]+(:\d+)?$/i.test(host)) return config.authSigninUrl;
  const proto = request.headers.get('x-forwarded-proto') === 'https' ? 'https' : 'http';
  return `${proto}://${host}`;
}

/** The fast response: identity only, zero D1 work. */
export function identityPayload(request: Request, config: Config, session: Session): SessionIdentity {
  return {
    authenticated: true,
    user: {
      username: session.username,
      email: session.email,
      name: session.name,
      firstName: session.firstName,
      lastName: session.lastName,
      // The account widget shows the real photo when Accounts has one.
      avatarUrl: session.avatarUrl,
    },
    // The account this TAB is showing (from /u/<n>/ or X-Gothwad-Authuser).
    authuser: session.authuser,
    activeId: session.activeId,
    accounts: session.accounts,
    // Browser-facing link for THIS account, so it uses AUTH_SIGNIN_URL.
    accountUrl: session.accountUrl,
    // Keeps the domain out of the browser bundle.
    accountsWebOrigin: accountsWebOriginFor(request, config),
    meta: false,
    unread: null,
    limits: null,
  };
}

/**
 * Unread badges and the send quota, in parallel.
 *
 * Each half fails on its own: a broken unread query must not also hide the
 * quota, and neither may turn a verified session into an error.
 */
export async function loadSessionMeta(env: Env, config: Config, session: Session): Promise<SessionMeta> {
  const usernames = session.accounts.map((a) => a.username);

  const [unread, remaining] = await Promise.all([
    unreadCounts(env, usernames),
    sentRemainingToday(env, config, session),
  ]);

  return {
    authuser: session.authuser,
    unread,
    limits: { dailySendLimit: config.dailySendLimit, sendRemainingToday: remaining },
  };
}

/** How many sends are left today; `null` when D1 cannot answer. */
async function sentRemainingToday(env: Env, config: Config, session: Session): Promise<number | null> {
  try {
    const db = await Db.from(env);
    const sent = await mail.countSentToday(db, session.username);
    return Math.max(config.dailySendLimit - sent, 0);
  } catch {
    // The quota is enforced in handleSend, which re-counts before sending. This
    // number is only the label under the Compose button, so failing soft is fine.
    return null;
  }
}

/** Identity plus metadata: the shape `/api/session` has always returned. */
export type FullSession = Omit<SessionIdentity, 'meta' | 'unread' | 'limits'> &
  SessionMeta & { meta: true };

export function fullPayload(
  request: Request,
  config: Config,
  session: Session,
  meta: SessionMeta
): FullSession {
  return {
    ...identityPayload(request, config, session),
    // The metadata may have been computed for a slightly different slot if
    // Accounts healed the session between the two calls; trust the fresh value.
    authuser: meta.authuser,
    meta: true,
    unread: meta.unread,
    limits: meta.limits,
  };
}
