// =============================================================================
// The account menu host.
//
// Mail does not draw its own switcher any more: it opens the shared
// Accounts-hosted widget (`window.GothwadAccountMenu`), the same sheet Google
// shows on every surface. This component only:
//
//   open  -> build the widget's (state, opts) from Mail's live data
//   live  -> push updates while it is open (unread counts, theme, accounts)
//   close -> keep React state in sync when the widget closes itself (Esc/tap)
//   fail  -> render the small in-app fallback so the avatar is never dead
//
// All the actual work (switching, drafts, caches, sign-out) stays in Mail's own
// handlers, so the widget cannot bypass them.
// =============================================================================

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useMail } from '../context/MailContext';
import { buildAccountMenu, type AccountMenuInput } from '../services/accountMenu';
import {
  closeAccountWidget,
  openAccountWidget,
  updateAccountWidget,
} from '../services/accountWidget';
import { AccountSheetFallback } from './AccountSheetFallback';

export interface AccountSheetProps {
  isOpen: boolean;
  /** The avatar button that opened it: the widget positions the card under it. */
  anchorEl: HTMLElement | null;
  onClose: () => void;
}

export const AccountSheet: React.FC<AccountSheetProps> = ({ isOpen, anchorEl, onClose }) => {
  const {
    currentUser,
    accounts,
    activeAccountId,
    authuser,
    accountUnread,
    accountsWebOrigin,
    accountUrl,
    addAccountUrl,
    theme,
    toggleTheme,
    setIsSettingsModalOpen,
    switchAccount,
    signOutAccount,
    signOutAllAccounts,
    showToast,
  } = useMail();

  // Why the shared widget could not open. Non-null => show the fallback sheet.
  const [fallbackReason, setFallbackReason] = useState<string | null>(null);

  const build = useCallback(
    (): AccountMenuInput =>
      buildAccountMenu({
        user: currentUser,
        accounts,
        activeId: activeAccountId,
        authuser,
        theme,
        unread: accountUnread,
        accountsWebOrigin,
        accountUrl,
        href: window.location.href,
        anchorEl,
        extras: [
          {
            label: 'Mail settings',
            onClick: () => {
              onClose();
              setIsSettingsModalOpen(true);
            },
          },
          {
            label: theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme',
            onClick: () => toggleTheme(),
          },
        ],
        handlers: {
          // The widget closes itself first; Mail then does the real switch
          // (draft flush -> URL -> cached mailbox), so nothing is skipped.
          onSwitchAccount: (account) => {
            onClose();
            void switchAccount(account.id);
          },
          onSignOutAccount: (slotId) => {
            onClose();
            void signOutAccount(slotId);
          },
          onSignOutAll: () => {
            onClose();
            void signOutAllAccounts();
          },
          onError: (message) => showToast(message),
          onClose,
        },
      }),
    [
      accountUnread,
      accountUrl,
      accounts,
      accountsWebOrigin,
      activeAccountId,
      anchorEl,
      authuser,
      currentUser,
      onClose,
      setIsSettingsModalOpen,
      showToast,
      signOutAccount,
      signOutAllAccounts,
      switchAccount,
      theme,
      toggleTheme,
    ]
  );

  // The effect must not re-run every time a callback identity changes, so it
  // reads the newest builder through a ref.
  const buildRef = useRef(build);
  useEffect(() => {
    buildRef.current = build;
  }, [build]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setFallbackReason(null);
    const { state, opts } = buildRef.current();
    void openAccountWidget(accountsWebOrigin, state, opts).then((result) => {
      if (cancelled) {
        if (result.ok) closeAccountWidget();
        return;
      }
      if (!result.ok) setFallbackReason(result.message);
    });
    return () => {
      cancelled = true;
      closeAccountWidget();
    };
  }, [isOpen, accountsWebOrigin]);

  // While the sheet is open, keep it live: a message arriving changes the
  // unread pills, and toggling the theme must not leave a light card on a dark
  // page.
  useEffect(() => {
    if (!isOpen || fallbackReason) return;
    const { state, opts } = buildRef.current();
    updateAccountWidget(state, opts);
  }, [isOpen, fallbackReason, accounts, accountUnread, theme, activeAccountId, authuser, accountUrl]);

  if (!isOpen) return null;
  if (!fallbackReason) return null;
  return (
    <AccountSheetFallback
      accounts={accounts}
      activeId={activeAccountId}
      unread={accountUnread}
      accountUrl={accountUrl}
      addAccountUrl={addAccountUrl}
      theme={theme}
      reason={fallbackReason}
      onClose={onClose}
      onSwitch={(account) => {
        onClose();
        void switchAccount(account.id);
      }}
      onSignOut={(id) => {
        void signOutAccount(id);
      }}
      onSignOutAll={() => {
        onClose();
        void signOutAllAccounts();
      }}
      onToggleTheme={toggleTheme}
      onOpenSettings={() => {
        onClose();
        setIsSettingsModalOpen(true);
      }}
    />
  );
};
