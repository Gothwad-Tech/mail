// =============================================================================
// Maps Mail's state onto the shared account widget's `open(state, opts)` call.
//
// Keeping this pure (no React, no DOM reads beyond what is passed in) has two
// benefits: the widget contract is visible in one small file, and the mapping
// can be unit-tested without a browser.
//
// The widget is Google's OneGoogle-style sheet: it renders the active user, the
// other signed-in accounts, unread pills, "Add another account", manage/sign-out
// rows and a "Manage your account" link. Mail supplies data and callbacks only;
// every pixel lives in Accounts.
// =============================================================================

import type { AccountSummary } from './mailApi';

export interface MenuUser {
  username: string;
  name: string | null;
  firstName?: string;
  lastName?: string;
  email: string;
  avatarUrl?: string | null;
}

/** One extra row the sheet shows under the account list (Settings, Theme). */
export interface MenuExtraAction {
  label: string;
  onClick: () => void;
}

export interface BuildMenuArgs {
  user: MenuUser;
  accounts: AccountSummary[];
  activeId: string | null;
  authuser: number;
  theme: 'light' | 'dark';
  /** username -> unread inbox count (Mail's D1). */
  unread: Record<string, number>;
  /** Accounts web origin, from the session. Never hardcoded. */
  accountsWebOrigin: string;
  /** Accounts' profile page for the active account. */
  accountUrl: string;
  /** Current address, used as the return target after "Add another account". */
  href: string;
  anchorEl: HTMLElement | null;
  extras?: MenuExtraAction[];
  handlers: {
    onSwitchAccount: (account: AccountSummary) => void;
    onSignOutAccount: (slotId: string) => void;
    onSignOutAll: () => void;
    onError: (message: string) => void;
    onClose: () => void;
  };
}

export interface AccountMenuInput {
  state: Record<string, unknown>;
  opts: Record<string, unknown>;
}

function trimOrigin(raw: string): string {
  return (raw || '').trim().replace(/\/+$/, '');
}

/**
 * Google's own URLs: `/u/<n>/` is one account's mailbox. Returning a path (not
 * an absolute URL) keeps Ctrl/Cmd/middle-click inside the app.
 */
export function accountHrefFor(account: Pick<AccountSummary, 'authuser'>): string {
  const index = Number.isInteger(account.authuser) ? Math.min(Math.max(account.authuser, 0), 5) : 0;
  return `/u/${index}/`;
}

/**
 * Accounts' profile page for this account. Prefers the URL the Worker already
 * built from config; falls back to the origin + Google's `/u/<n>/me` shape.
 */
export function manageHrefFor(accountsWebOrigin: string, authuser: number, accountUrl?: string): string {
  if (accountUrl && /^https?:\/\//i.test(accountUrl)) return accountUrl;
  const origin = trimOrigin(accountsWebOrigin);
  const index = Number.isInteger(authuser) ? Math.min(Math.max(authuser, 0), 5) : 0;
  return origin ? `${origin}/u/${index}/me` : '';
}

/** Builds the two arguments the widget's `open()` expects. */
export function buildAccountMenu(args: BuildMenuArgs): AccountMenuInput {
  const origin = trimOrigin(args.accountsWebOrigin);

  const state = {
    user: {
      username: args.user.username,
      name: args.user.name,
      firstName: args.user.firstName ?? '',
      lastName: args.user.lastName ?? '',
      email: args.user.email,
      avatarUrl: args.user.avatarUrl ?? null,
    },
    // The widget normalises each entry itself; Mail's shape already matches
    // (id, authuser, username, name, firstName, lastName, email, avatarUrl).
    accounts: args.accounts,
    activeId: args.activeId,
    authuser: args.authuser,
  };

  const opts = {
    anchorEl: args.anchorEl,
    theme: args.theme,
    badges: args.unread,
    accountHref: accountHrefFor,
    nextUrl: args.href,
    manageAccountHref: manageHrefFor(origin, args.authuser, args.accountUrl),
    // Only set when Mail knows the origin: the widget otherwise infers it from
    // its own script URL, which is the same host.
    ...(origin ? { accountsWebOrigin: origin } : {}),
    ecosystemName: 'Gothwad',
    extraActions: args.extras ?? [],
    onSwitchAccount: args.handlers.onSwitchAccount,
    onSignOutAccount: args.handlers.onSignOutAccount,
    onSignOutAll: args.handlers.onSignOutAll,
    onError: args.handlers.onError,
    onClose: args.handlers.onClose,
  };

  return { state, opts };
}
