// =============================================================================
// Google-style account switcher (client side).
//
// Switching is instant and reload-free:
//   1. the open draft is flushed under the CURRENT account (its /u/<n>/ header)
//   2. the URL becomes /u/<target>/ in the same tick, and the session is updated
//      from the switcher list, so the provider remounts and paints that
//      account's cached mailbox (<16ms, no network on the critical path)
//   3. in the background: POST /api/mail/accounts/switch makes it the browser's
//      active account and rotates the slot cookies, then the session reconciles
//
// Reading a slot never touches other tabs: every call carries this tab's
// X-Gothwad-Authuser, and the session route resolves that slot server-side.
// =============================================================================

import { useCallback, useEffect, useState } from 'react';
import { ApiError, mailApi, type AccountSummary, type AccountsInfo } from '../services/mailApi';
import { errorText } from './mailHelpers';
import { navigateToAccount } from '../services/authuser';
import { clearAllMailboxCaches, dropAccountMailboxCache } from '../services/mailboxCache';
import type { EmailFolder } from '../types/email';

interface UseAccountsSwitcherOptions {
  showToast: (message: string) => void;
  currentFolder: EmailFolder;
  /** Flush + close an open draft under the account that owns it. */
  prepareForAccountSwitch: () => Promise<void>;
  resetForAccountSwitch: () => void;
  onSessionChanged: () => Promise<void>;
  /** Paint the target account immediately, before the network answers. */
  onSwitchAccount: (account: AccountSummary, all: AccountSummary[], unread: Record<string, number>) => void;
  initial?: AccountsInfo | null;
}

export function useAccountsSwitcher({
  showToast,
  currentFolder,
  prepareForAccountSwitch,
  resetForAccountSwitch,
  onSessionChanged,
  onSwitchAccount,
  initial,
}: UseAccountsSwitcherOptions) {
  const [accounts, setAccounts] = useState<AccountSummary[]>(initial?.accounts ?? []);
  const [activeAccountId, setActiveAccountId] = useState<string | null>(initial?.activeId ?? null);
  const [accountUnread, setAccountUnread] = useState<Record<string, number>>(initial?.unread ?? {});
  const [accountsUnsupported, setAccountsUnsupported] = useState(initial?.unsupported === true);
  const [isLoadingAccounts, setIsLoadingAccounts] = useState(false);
  const [switchingAccountId, setSwitchingAccountId] = useState<string | null>(null);

  const applyAccounts = useCallback((info: AccountsInfo) => {
    setAccounts(info.accounts);
    setActiveAccountId(info.activeId);
    setAccountUnread(info.unread);
    setAccountsUnsupported(info.unsupported === true);
  }, []);

  /**
   * Refresh the list. `force` skips the boot-time fetch, because /api/session
   * already returned the same payload (single-call boot).
   */
  const refreshAccounts = useCallback(() => {
    setIsLoadingAccounts(true);
    void mailApi
      .getAccounts()
      .then(applyAccounts)
      .catch(() => undefined)
      .finally(() => setIsLoadingAccounts(false));
  }, [applyAccounts]);

  useEffect(() => {
    // The session response already carried accounts + unread; only fetch when
    // the app started without them (old Accounts build or a bearer session).
    if (initial && (initial.accounts.length > 0 || initial.unsupported)) return;
    refreshAccounts();
  }, [initial, refreshAccounts]);

  /** Resolves true when the tab is now showing the target account. */
  const switchAccount = useCallback(
    async (id: string): Promise<boolean> => {
      const target = accounts.find((a) => a.id === id);
      if (!target) return false;
      if (id === activeAccountId) return true;

      // 1. Draft safety: it belongs to the account that is on screen right now.
      await prepareForAccountSwitch();

      // 2. Instant tab switch: URL first (every later fetch carries the new
      //    index), then the optimistic session, which remounts the provider on
      //    the target's cached mailbox.
      navigateToAccount(target.authuser, currentFolder);
      onSwitchAccount(target, accounts, accountUnread);
      setActiveAccountId(target.id);

      // 3. Background: make it the browser active account too.
      setSwitchingAccountId(id);
      try {
        const info = await mailApi.switchAccount({ id });
        applyAccounts(info);
        await onSessionChanged();
        return true;
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          // That slot's session is gone. Send the user to re-auth exactly that
          // account, keeping this tab's URL as the return target.
          const url = err.reauthUrl ?? mailApi.reauthUrl(target.authuser, target.username);
          window.location.assign(url);
          return false;
        }
        showToast(errorText(err));
        return false;
      } finally {
        setSwitchingAccountId(null);
      }
    },
    [
      accounts,
      activeAccountId,
      accountUnread,
      currentFolder,
      onSessionChanged,
      onSwitchAccount,
      prepareForAccountSwitch,
      showToast,
    ]
  );

  const signOutAccount = useCallback(
    async (id: string) => {
      const signedOut = accounts.find((a) => a.id === id);
      setSwitchingAccountId(id);
      try {
        const info = await mailApi.signOutAccount(id);
        applyAccounts(info);

        // That mailbox must not stay in memory after its account is gone.
        if (signedOut) dropAccountMailboxCache(signedOut.id);

        if (info.accounts.length === 0) {
          // Nothing left: the session check will send the browser to sign in.
          await onSessionChanged();
          return;
        }

        if (id === activeAccountId) {
          // Signing out the account this tab shows: move to the promoted one
          // instead of signing the whole browser out.
          const next = info.accounts.find((a) => a.id === info.activeId) ?? info.accounts[0];
          navigateToAccount(next.authuser, currentFolder);
          onSwitchAccount(next, info.accounts, info.unread);
          resetForAccountSwitch();
        }
        await onSessionChanged();
      } catch (err) {
        showToast(errorText(err));
      } finally {
        setSwitchingAccountId(null);
      }
    },
    [
      accounts,
      activeAccountId,
      currentFolder,
      onSessionChanged,
      onSwitchAccount,
      resetForAccountSwitch,
      showToast,
    ]
  );

  /**
   * Sign out of every account in this browser. Accounts revokes all slot
   * cookies; the session re-check then answers 401 and the app leaves for
   * sign-in, exactly like a first visit. No account data is kept in memory.
   */
  const signOutAll = useCallback(async () => {
    try {
      await mailApi.signOutAll();
      clearAllMailboxCaches();
      await onSessionChanged();
    } catch (err) {
      showToast(errorText(err));
    }
  }, [onSessionChanged, showToast]);

  /** Accounts' "add another account" link, carrying this tab's index. */
  const addAccountUrl = `/api/mail/accounts/add?authuser=${accounts.length > 0 ? Math.min(accounts.length, 5) : 0}`;

  return {
    accounts,
    activeAccountId,
    accountUnread,
    accountsUnsupported,
    isLoadingAccounts,
    switchingAccountId,
    refreshAccounts,
    switchAccount,
    signOutAccount,
    signOutAll,
    addAccountUrl,
  };
}

export type AccountsSwitcherStore = ReturnType<typeof useAccountsSwitcher>;
