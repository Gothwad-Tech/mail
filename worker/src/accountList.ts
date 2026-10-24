// =============================================================================
// The browser's signed-in account list, as Accounts sends it.
//
// Accounts `GET /api/auth/me` (and `/api/auth/accounts`, `/api/auth/switch`,
// `/api/auth/accounts/:id/signout`) all return the same `accounts[]` shape.
// This module validates that shape once, so the session route and the switcher
// route cannot drift apart:
//
//   { id: 'a', authuser: 0, username, firstName, lastName, email, avatarUrl,
//     accountUrl, lastUsedAt }
//
// Rules:
//   - an entry Mail cannot fully trust is dropped, never half-rendered
//   - `email` is DERIVED from username + APP_DOMAIN (Accounts' copy is ignored)
//   - the list is ordered by Accounts' own `authuser`, then re-numbered 0..n, so
//     `/u/<n>/` always names an account we hand back and the same account the
//     browser shows; a missing/duplicate numbering falls back to array order
// =============================================================================

import type { Config, Env } from './config';
import { Db } from './db';
import { deriveEmail, normalizeUsername } from './session';

export interface PublicAccount {
  /** Accounts' slot id ("a".."f"). Opaque to Mail, only echoed back. */
  id: string;
  /** Google-style index used in the URL: /u/<authuser>/. */
  authuser: number;
  username: string;
  name: string | null;
  firstName: string;
  lastName: string;
  email: string;
  avatarUrl: string | null;
  /** Accounts' own profile page for this account. */
  accountUrl: string;
  lastUsedAt: string | null;
}

interface RawAccount {
  id?: unknown;
  authuser?: unknown;
  username?: unknown;
  firstName?: unknown;
  lastName?: unknown;
  avatarUrl?: unknown;
  accountUrl?: unknown;
  lastUsedAt?: unknown;
}

/** Accounts' hard cap: six signed-in accounts per browser. */
export const MAX_ACCOUNTS = 6;
const SLOT_RE = /^[a-f]$/;

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Validates Accounts' `accounts[]`. `fallbackAccountUrl` is used when the
 * upstream entry has no accountUrl (older Accounts builds).
 */
export function parseAccounts(
  rawList: unknown,
  config: Config,
  fallbackAccountUrl?: (authuser: number) => string
): PublicAccount[] {
  const list = Array.isArray(rawList) ? (rawList as RawAccount[]) : [];
  const out: PublicAccount[] = [];
  const seenSlots = new Set<string>();
  const seenUsers = new Set<string>();

  // Accounts numbers slots 0..5. Keep that order, so tab `/u/1/` is the account
  // Accounts calls 1 and a promoted account really is the one the UI paints.
  const ordered = [...list].sort((left, right) => {
    const a = typeof left?.authuser === 'number' ? left.authuser : Number.MAX_SAFE_INTEGER;
    const b = typeof right?.authuser === 'number' ? right.authuser : Number.MAX_SAFE_INTEGER;
    return a - b;
  });

  for (const raw of ordered) {
    if (out.length >= MAX_ACCOUNTS) break;
    const id = text(raw?.id).toLowerCase();
    const username = normalizeUsername(raw?.username);
    // A slot id outside a..f, or a duplicate, is not something Mail will show:
    // one bad row must never make the switcher offer a mailbox that is not
    // really signed in.
    if (!SLOT_RE.test(id) || !username) continue;
    if (seenSlots.has(id) || seenUsers.has(username)) continue;
    seenSlots.add(id);
    seenUsers.add(username);

    const firstName = text(raw?.firstName);
    const lastName = text(raw?.lastName);
    const authuser = out.length;
    out.push({
      id,
      authuser,
      username,
      name: [firstName, lastName].filter(Boolean).join(' ') || null,
      firstName,
      lastName,
      email: deriveEmail(username, config.appDomain),
      avatarUrl: text(raw?.avatarUrl) || null,
      accountUrl: text(raw?.accountUrl) || fallbackAccountUrl?.(authuser) || `${config.authSigninUrl}/u/${authuser}/me`,
      lastUsedAt: text(raw?.lastUsedAt) || null,
    });
  }
  return out;
}

/**
 * The account the request belongs to: the one whose `authuser` matches the
 * validated accounts array. Defaults to the first (index 0) like Google.
 */
export function pickAccount(accounts: PublicAccount[], authuser: number): PublicAccount | null {
  return accounts[authuser] ?? accounts[0] ?? null;
}

/**
 * Unread inbox counts for the accounts in the list.
 *
 * Only usernames that Accounts just confirmed are queried, so this can never be
 * used to read another mailbox's counts. One grouped query, not one per account.
 *
 * Returns `null` when the count could not be computed. That distinction matters:
 * an empty object would render as "0 unread" for every account, which is a claim
 * the database never made. Callers either show the badges (object) or show
 * nothing until a retry (null).
 */
export async function unreadCounts(env: Env, usernames: string[]): Promise<Record<string, number> | null> {
  const unique = [...new Set(usernames)].slice(0, MAX_ACCOUNTS);
  // No usernames (bearer or dev session) is a real answer, not a failure.
  if (unique.length === 0) return {};
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
    return null;
  }
}
