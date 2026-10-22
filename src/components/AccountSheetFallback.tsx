// =============================================================================
// The in-app account sheet, used ONLY when the shared Accounts widget cannot be
// loaded (offline, blocked script host, widget redeploying).
//
// It deliberately mirrors the widget's rows and wording so the user never sees a
// dead avatar, but it is not a second design: once the widget loads, it wins.
// =============================================================================

import React, { useEffect, useRef } from 'react';
import { X, Check, Plus, LogOut, ExternalLink, Settings, Sun, Moon, Mail } from 'lucide-react';
import type { AccountSummary } from '../services/mailApi';

export interface AccountSheetFallbackProps {
  accounts: AccountSummary[];
  activeId: string | null;
  unread: Record<string, number>;
  accountUrl: string;
  addAccountUrl: string;
  theme: 'light' | 'dark';
  reason: string | null;
  onClose: () => void;
  onSwitch: (account: AccountSummary) => void;
  onSignOut: (id: string) => void;
  onSignOutAll: () => void;
  onToggleTheme: () => void;
  onOpenSettings: () => void;
}

const initials = (account: AccountSummary): string => {
  const source = `${account.firstName || ''} ${account.lastName || ''}`.trim() || account.name || account.username;
  const parts = source.split(/[\s._-]+/).filter(Boolean);
  return ((parts.length >= 2 ? parts[0][0] + parts[1][0] : source.slice(0, 2)) || '?').toUpperCase();
};

const Avatar: React.FC<{ account: AccountSummary; size: number }> = ({ account, size }) => (
  <span
    className="flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#0494f4] font-semibold text-white"
    style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}
  >
    {account.avatarUrl ? (
      <img src={account.avatarUrl} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
    ) : (
      initials(account)
    )}
  </span>
);

export const AccountSheetFallback: React.FC<AccountSheetFallbackProps> = (props) => {
  const { accounts, activeId, unread, theme, reason } = props;
  const dialogRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<Element | null>(null);

  // Like the shared widget: focus moves into the sheet, Escape closes it, and
  // closing puts focus back on the avatar that opened it.
  useEffect(() => {
    returnFocusRef.current = document.activeElement;
    dialogRef.current?.focus();
    return () => {
      const previous = returnFocusRef.current;
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      props.onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex select-none items-end justify-center bg-black/60 sm:items-center">
      <div className="fixed inset-0" onClick={props.onClose} />
      <div
        ref={dialogRef}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        role="dialog"
        aria-modal="true"
        aria-label="Account menu"
        className="relative z-10 max-h-[90dvh] w-full overflow-y-auto overscroll-contain rounded-t-3xl bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl sm:max-w-sm sm:rounded-3xl dark:bg-[#212121]"
      >
        <div className="flex items-center justify-between pb-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-neutral-400">Accounts</span>
          <button
            type="button"
            onClick={props.onClose}
            aria-label="Close account menu"
            className="rounded-full p-1.5 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-[#2e2e2e]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {reason && (
          <p className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-[11px] leading-snug text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
            The shared account menu could not load, so this is Mail's built-in menu.
          </p>
        )}

        <ul className="space-y-0.5">
          {accounts.map((account) => {
            const isActive = account.id === activeId;
            const count = unread[account.username] ?? 0;
            return (
              <li key={account.id} className="flex items-center gap-2 rounded-full px-2 hover:bg-neutral-100 dark:hover:bg-[#2a2a2a]">
                <button
                  type="button"
                  onClick={() => (isActive ? props.onClose() : props.onSwitch(account))}
                  aria-current={isActive ? 'true' : undefined}
                  className="flex min-h-[56px] min-w-0 flex-1 items-center gap-3 text-left"
                >
                  <Avatar account={account} size={40} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-neutral-900 dark:text-white">
                      {account.name || account.username}
                    </span>
                    <span className="block truncate text-xs text-neutral-500 dark:text-neutral-400">
                      {account.email}
                    </span>
                  </span>
                  {count > 0 && (
                    <span className="rounded-full bg-[#0494f4] px-1.5 py-0.5 text-[10px] font-bold text-white">
                      {count > 99 ? '99+' : count}
                    </span>
                  )}
                  {isActive && <Check className="h-4 w-4 shrink-0 text-[#0494f4]" aria-label="Active account" />}
                </button>
                <button
                  type="button"
                  onClick={() => props.onSignOut(account.id)}
                  aria-label={`Sign out of ${account.email}`}
                  className="rounded-full p-2 text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700 dark:hover:bg-[#383838]"
                >
                  <LogOut className="h-4 w-4" />
                </button>
              </li>
            );
          })}
        </ul>

        <a
          href={props.addAccountUrl}
          className="mt-1 flex min-h-[52px] items-center gap-3 rounded-full px-2 text-sm font-medium text-neutral-800 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-[#2a2a2a]"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-full border border-dashed border-neutral-400 text-neutral-600 dark:text-neutral-300">
            <Plus className="h-4 w-4" />
          </span>
          Add another account
        </a>

        {accounts.length > 1 && (
          <button
            type="button"
            onClick={props.onSignOutAll}
            className="flex min-h-[48px] w-full items-center gap-3 rounded-full px-2 text-sm font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"
          >
            <span className="flex h-10 w-10 items-center justify-center">
              <LogOut className="h-4 w-4" />
            </span>
            Sign out of all accounts
          </button>
        )}

        <div className="mt-2 space-y-0.5 border-t border-neutral-100 pt-2 dark:border-[#2f2f2f]">
          <button
            type="button"
            onClick={props.onToggleTheme}
            className="flex min-h-[48px] w-full items-center gap-3 rounded-full px-3 text-sm text-neutral-800 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-[#2a2a2a]"
          >
            {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            Switch to {theme === 'dark' ? 'light' : 'dark'} theme
          </button>
          <button
            type="button"
            onClick={props.onOpenSettings}
            className="flex min-h-[48px] w-full items-center gap-3 rounded-full px-3 text-sm text-neutral-800 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-[#2a2a2a]"
          >
            <Settings className="h-4 w-4" />
            Mail settings
          </button>
          <a
            href={props.accountUrl}
            className="flex min-h-[48px] w-full items-center gap-3 rounded-full px-3 text-sm text-neutral-800 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-[#2a2a2a]"
          >
            <Mail className="h-4 w-4" />
            <span className="flex-1">Manage your Gothwad Account</span>
            <ExternalLink className="h-3.5 w-3.5 text-neutral-400" />
          </a>
        </div>
      </div>
    </div>
  );
};
