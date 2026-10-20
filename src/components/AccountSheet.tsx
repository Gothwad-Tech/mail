import React, { useState } from 'react';
import { X, Settings, Sun, Moon, ExternalLink, ShieldCheck, Check, Plus, LogOut, Loader2 } from 'lucide-react';
import { useMail } from '../context/MailContext';
import { PWAInstallButton } from './PWAInstallButton';
import type { AccountSummary } from '../services/mailApi';

interface AccountSheetProps {
  isOpen: boolean;
  onClose: () => void;
}

/** Two letters for the avatar circle, from the name if there is one. */
function initialsFor(account: AccountSummary): string {
  const source = (account.name && account.name.trim()) || account.username;
  const parts = source.split(/[\s._-]+/).filter(Boolean);
  return (parts.length >= 2 ? parts[0][0] + parts[1][0] : source.slice(0, 2)).toUpperCase();
}

/** Unread badge per row. Hidden at zero so the list stays quiet. */
const UnreadPill: React.FC<{ count: number }> = ({ count }) => {
  if (count <= 0) return null;
  return (
    <span className="rounded-full bg-[#0494f4] px-1.5 py-0.5 text-[10px] font-bold leading-4 text-white">
      {count > 99 ? '99+' : count}
    </span>
  );
};

export const AccountSheet: React.FC<AccountSheetProps> = ({ isOpen, onClose }) => {
  const {
    currentUser,
    theme,
    toggleTheme,
    setIsSettingsModalOpen,
    accountUrl,
    accounts,
    activeAccountId,
    accountUnread,
    isLoadingAccounts,
    switchingAccountId,
    switchAccount,
    signOutAccount,
    addAccountUrl,
  } = useMail();

  // Signing out the last account ends the whole session, so ask first.
  const [pendingSignOut, setPendingSignOut] = useState<string | null>(null);

  if (!isOpen) return null;

  const hasSwitcher = accounts.length > 0;
  const isLastAccount = accounts.length === 1;

  const handleSignOut = async (account: AccountSummary) => {
    if (isLastAccount && pendingSignOut !== account.id) {
      setPendingSignOut(account.id);
      return;
    }
    setPendingSignOut(null);
    await signOutAccount(account.id);
    if (isLastAccount) onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex select-none items-end justify-center bg-black/60 backdrop-blur-xs sm:items-center">
      {/* Backdrop */}
      <div className="fixed inset-0" onClick={onClose} />

      {/* Surface */}
      <div className="relative z-10 w-full max-h-[90dvh] overflow-y-auto overscroll-contain rounded-t-3xl border border-neutral-200 bg-white p-5 shadow-2xl animate-in slide-in-from-bottom duration-200 sm:max-w-md sm:rounded-2xl dark:border-[#383838] dark:bg-[#212121]">
        {/* Grab handle on mobile */}
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-neutral-300 sm:hidden dark:bg-neutral-600" />

        {/* Top bar with close button */}
        <div className="flex items-center justify-between border-b border-neutral-100 pb-3 dark:border-[#2f2f2f]">
          <span className="text-xs font-bold uppercase tracking-wider text-neutral-400">
            {hasSwitcher ? 'Gothwad Accounts' : 'Gothwad Account'}
          </span>
          <button
            onClick={onClose}
            className="rounded-full p-1 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-[#2e2e2e]"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Account list: the same profile section Google shows. */}
        {hasSwitcher ? (
          <div className="py-3">
            <ul className="space-y-1" aria-label="Signed-in accounts">
              {accounts.map((account) => {
                const isActive = account.id === activeAccountId;
                const isBusy = switchingAccountId === account.id;
                const unread = accountUnread[account.username] ?? 0;
                return (
                  <li key={account.id}>
                    <div
                      className={`group flex min-h-[56px] items-center gap-3 rounded-xl px-2 py-2 transition-colors ${
                        isActive
                          ? 'bg-[#0494f4]/8'
                          : 'hover:bg-neutral-50 dark:hover:bg-[#2a2a2a]'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          if (isActive || isBusy) return;
                          void switchAccount(account.id).then((ok) => {
                            if (ok) onClose();
                          });
                        }}
                        disabled={isBusy || (switchingAccountId !== null && !isBusy)}
                        className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0494f4] disabled:opacity-60"
                        aria-current={isActive ? 'true' : undefined}
                      >
                        <span
                          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white shadow-sm ${
                            isActive ? 'bg-[#0494f4]' : 'bg-neutral-400 dark:bg-neutral-600'
                          }`}
                        >
                          {initialsFor(account)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-neutral-900 dark:text-white">
                            {account.name || account.username}
                          </span>
                          <span className="block truncate text-xs text-neutral-500 dark:text-neutral-400">
                            {account.email}
                          </span>
                        </span>
                      </button>

                      {isBusy ? (
                        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[#0494f4]" aria-label="Switching" />
                      ) : (
                        <div className="flex shrink-0 items-center gap-1">
                          {unread > 0 && <UnreadPill count={unread} />}
                          {isActive && (
                            <span
                              className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-[#0494f4]"
                              aria-label="Active account"
                            >
                              <Check className="h-4 w-4" />
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => void handleSignOut(account)}
                            className="rounded-full p-1.5 text-neutral-400 transition-colors hover:bg-neutral-200 hover:text-neutral-700 dark:hover:bg-[#383838] dark:hover:text-neutral-200"
                            aria-label={`Sign out of ${account.email}`}
                            title="Sign out"
                          >
                            <LogOut className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                    </div>

                    {pendingSignOut === account.id && (
                      <div className="mt-1 flex items-center justify-between gap-2 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
                        <span>This is your only account. Sign out of Mail?</span>
                        <span className="flex shrink-0 gap-2">
                          <button
                            className="font-bold underline"
                            onClick={() => void handleSignOut(account)}
                          >
                            Sign out
                          </button>
                          <button className="font-medium opacity-70" onClick={() => setPendingSignOut(null)}>
                            Cancel
                          </button>
                        </span>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>

            <a
              href={addAccountUrl}
              className="mt-2 flex min-h-[48px] w-full items-center gap-2 rounded-xl border border-transparent px-2 text-sm font-semibold text-[#0494f4] transition-colors hover:bg-[#0494f4]/8 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0494f4]"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-full border border-dashed border-[#0494f4]/60">
                <Plus className="h-4 w-4" />
              </span>
              Add another account
            </a>

            {isLoadingAccounts && (
              <p className="px-2 pt-1 text-[10px] text-neutral-400">Refreshing accounts…</p>
            )}
          </div>
        ) : (
          /* Fallback: Accounts has no multi-account API yet (or the list failed). */
          <div className="flex items-center gap-3.5 py-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#0494f4] text-lg font-bold text-white shadow-sm">
              {currentUser.avatarText}
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="truncate text-sm font-bold text-neutral-900 dark:text-white">
                {currentUser.name || currentUser.username}
              </h3>
              <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">{currentUser.email}</p>
              <div className="mt-1 flex items-center gap-1.5">
                <span className="inline-flex items-center gap-1 rounded-full bg-[#0494f4]/15 px-2 py-0.5 text-[10px] font-semibold text-[#0494f4]">
                  <ShieldCheck className="h-3 w-3" />
                  Workspace Active
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Quick Actions List */}
        <div className="space-y-1.5 border-t border-neutral-100 pt-3 dark:border-[#2f2f2f]">
          <PWAInstallButton className="w-full justify-center py-2.5" />

          {/* Manage the Gothwad Account itself (password, profile) on Accounts */}
          <a
            href={accountUrl}
            target="_blank"
            rel="noreferrer"
            className="flex w-full items-center justify-between rounded-xl border border-neutral-200 p-3 text-xs font-semibold text-neutral-800 transition-colors hover:bg-neutral-50 dark:border-[#333333] dark:text-neutral-200 dark:hover:bg-[#282828]"
          >
            <span>Manage Gothwad Account</span>
            <ExternalLink className="h-3.5 w-3.5 text-neutral-400" />
          </a>

          {/* Theme Switcher Button */}
          <button
            onClick={toggleTheme}
            className="flex w-full items-center justify-between rounded-xl border border-neutral-200 p-3 text-xs font-semibold text-neutral-800 transition-colors hover:bg-neutral-50 dark:border-[#333333] dark:text-neutral-200 dark:hover:bg-[#282828]"
          >
            <div className="flex items-center gap-2.5">
              {theme === 'dark' ? (
                <Sun className="h-4 w-4 text-[#0494f4]" />
              ) : (
                <Moon className="h-4 w-4 text-[#0494f4]" />
              )}
              <div className="text-left">
                <p>Theme: {theme === 'dark' ? 'Dark Mode (#212121)' : 'Light Mode (#ffffff)'}</p>
                <p className="text-[10px] font-normal text-neutral-400">
                  Tap to switch to {theme === 'dark' ? 'Light' : 'Dark'}
                </p>
              </div>
            </div>
            <span className="text-xs font-bold text-[#0494f4]">Toggle</span>
          </button>

          {/* Settings Button */}
          <button
            onClick={() => {
              onClose();
              setIsSettingsModalOpen(true);
            }}
            className="flex w-full items-center justify-between rounded-xl border border-neutral-200 p-3 text-xs font-semibold text-neutral-800 transition-colors hover:bg-neutral-50 dark:border-[#333333] dark:text-neutral-200 dark:hover:bg-[#282828]"
          >
            <div className="flex items-center gap-2.5">
              <Settings className="h-4 w-4 text-neutral-500" />
              <span>Gothwad Mail Preferences</span>
            </div>
            <ExternalLink className="h-3.5 w-3.5 text-neutral-400" />
          </button>
        </div>

        <div className="mt-4 border-t border-neutral-100 pt-3 text-center dark:border-[#2f2f2f]">
          <p className="text-[11px] font-medium text-neutral-400">Gothwad Mail</p>
        </div>
      </div>
    </div>
  );
};
