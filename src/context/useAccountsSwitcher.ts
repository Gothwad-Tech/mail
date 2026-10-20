// =============================================================================
// Account switcher state for the UI.
//
// The list itself lives in Accounts (one session per account there). Mail only
// mirrors it and adds the unread counts from its own D1. Switching is: one
// POST, clear this account's caches, then ask App to re-read /api/session
// (which remounts the provider because it is keyed by username).
// =============================================================================

import { useCallback, useEffect, useState } from 'react';
import { ApiError, mailApi, type AccountSummary, type AccountsInfo } from '../services/mailApi';
import { errorText } from './mailHelpers';

interface UseAccountsSwitcherOptions {
  showToast: (message: string) => void;
  closeCompose: () => void;
  resetForAccountSwitch: () => void;
  resetForAccountSignOut: () => void;
  onSessionChanged: () => Promise<void>;
}

export function useAccountsSwitcher({
  showToast,
  closeCompose,
  resetForAccountSwitch,
  resetForAccountSignOut,
  onSessionChanged,
}: UseAccountsSwitcherOptions) {
  const [accounts, setAccounts] = useState<AccountSummary[]>([]);
  const [activeAccountId, setActiveAccountId] = useState<string | null>(null);
  const [accountUnread, setAccountUnread] = useState<Record<string, number>>({});
  const [accountsUnsupported, setAccountsUnsupported] = useState(false);
  const [isLoadingAccounts, setIsLoadingAccounts] = useState(false);
  const [switchingAccountId, setSwitchingAccountId] = useState<string | null>(null);

  const applyAccounts = useCallback((info: AccountsInfo) => {
    setAccounts(info.accounts);
    setActiveAccountId(info.activeId);
    setAccountUnread(info.unread);
    setAccountsUnsupported(info.unsupported === true);
  }, []);

  const refreshAccounts = useCallback(() => {
    setIsLoadingAccounts(true);
    void mailApi
      .getAccounts()
      .then(applyAccounts)
      // A failed list is not worth a toast: the sheet still shows the signed-in
      // user, and the next open retries. A 401 is handled by the session hook.
      .catch(() => undefined)
      .finally(() => setIsLoadingAccounts(false));
  }, [applyAccounts]);

  // One GET per page load keeps the switcher ready before it is opened; it is
  // a single indexed count query in D1, not a poll.
  useEffect(() => {
    refreshAccounts();
  }, [refreshAccounts]);

  /** Resolves true when the active account really changed. */
  const switchAccount = useCallback(
    async (id: string): Promise<boolean> => {
      if (id === activeAccountId) return true;
      setSwitchingAccountId(id);
      try {
        const info = await mailApi.switchAccount(id);
        applyAccounts(info);
        resetForAccountSwitch();
        closeCompose();
        // New identity -> App re-reads /api/session and remounts the provider.
        await onSessionChanged();
        return true;
      } catch (err) {
        showToast(errorText(err));
        // 409: Accounts no longer has a session for that slot. Drop the row.
        if (err instanceof ApiError && err.status === 409) refreshAccounts();
        return false;
      } finally {
        setSwitchingAccountId(null);
      }
    },
    [activeAccountId, applyAccounts, closeCompose, onSessionChanged, refreshAccounts, resetForAccountSwitch, showToast]
  );

  const signOutAccount = useCallback(
    async (id: string) => {
      setSwitchingAccountId(id);
      try {
        const info = await mailApi.signOutAccount(id);
        applyAccounts(info);
        // Signing out the active account means the whole mailbox changes, or
        // the browser is signed out entirely if no account is left.
        if (id === activeAccountId || !info.activeId) {
          resetForAccountSignOut();
          await onSessionChanged();
        }
      } catch (err) {
        showToast(errorText(err));
      } finally {
        setSwitchingAccountId(null);
      }
    },
    [activeAccountId, applyAccounts, onSessionChanged, resetForAccountSignOut, showToast]
  );

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
  };
}

export type AccountsSwitcherStore = ReturnType<typeof useAccountsSwitcher>;
