// =============================================================================
// The mail store: one provider, composed from small hooks.
//
//   useMailbox           folder list, caches, opened message, actions
//   useCompose           compose window, send, draft autosave
//   useMailboxSettings   storage + retention
//   useAccountsSwitcher  the Google-style account list
//   (this file)          theme, toast, view state, search, the context value
//
// Everything a component needs is still reached through `useMail()`; the split
// exists so no single file has to hold all of it.
// =============================================================================

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { EmailFolder, UserProfile } from '../types/email';
import type { AccountSummary, SessionUser } from '../services/mailApi';
import { initials, toComposeData, toEmailMessage } from './mailHelpers';
import {
  EMPTY_FILTER,
  MailContext,
  type MailContextType,
  type SearchFilterOptions,
  type ToastInfo,
} from './mailContextTypes';
import { useMailbox } from './useMailbox';
import { useCompose } from './useCompose';
import { useMailboxSettings } from './useMailboxSettings';
import { useAccountsSwitcher } from './useAccountsSwitcher';

export const MailProvider: React.FC<{
  user: SessionUser;
  sendRemainingToday: number | null;
  dailySendLimit: number | null;
  accountUrl: string;
  /** This tab's account index from /u/<n>/ (0..5). */
  authuser: number;
  /** Accounts slot id for that index. */
  activeId: string | null;
  /** Switcher list + unread counts, already returned by /api/session. */
  accounts: AccountSummary[];
  unread: Record<string, number>;
  /** Re-reads /api/session after the active account changed. */
  onSessionChanged: () => Promise<void>;
  /** Paint a target account immediately (before the switch call answers). */
  onSwitchAccount: (account: AccountSummary, all: AccountSummary[], unread: Record<string, number>) => void;
  children: React.ReactNode;
}> = ({
  user,
  sendRemainingToday: initialRemaining,
  dailySendLimit,
  accountUrl,
  authuser,
  activeId,
  accounts: initialAccounts,
  unread: initialUnread,
  onSessionChanged,
  onSwitchAccount,
  children,
}) => {
  const [sendRemainingToday, setSendRemainingToday] = useState<number | null>(initialRemaining);

  // ----- UI state ------------------------------------------------------------
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [splitView, setSplitView] = useState<'none' | 'vertical' | 'horizontal'>('none');

  const [searchQuery, setSearchQuery] = useState('');
  const [searchFilter, setSearchFilter] = useState<SearchFilterOptions>(EMPTY_FILTER);
  const [isSearchFilterOpen, setIsSearchFilterOpen] = useState(false);

  // Theme: strictly light (#ffffff) or dark (#212121)
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      const saved = localStorage.getItem('gothwad_mail_theme');
      if (saved === 'dark' || saved === 'light') return saved;
      if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        return 'dark';
      }
    } catch {
      // fallback
    }
    return 'light';
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    try {
      localStorage.setItem('gothwad_mail_theme', theme);
    } catch {
      // ignore
    }
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === 'light' ? 'dark' : 'light'));
  }, []);

  // Toast
  const [toast, setToast] = useState<ToastInfo | null>(null);

  const showToast = useCallback((message: string) => {
    const id = Date.now().toString();
    setToast({ id, message });
    setTimeout(() => {
      setToast((cur) => (cur?.id === id ? null : cur));
    }, 4500);
  }, []);

  const dismissToast = useCallback(() => setToast(null), []);

  // ----- The composed stores ------------------------------------------------
  // The slot id scopes the mailbox cache: /u/0 and /u/1 never share a list.
  const mailbox = useMailbox({ showToast, accountKey: activeId ?? `u${authuser}` });

  const compose = useCompose({
    showToast,
    currentFolder: mailbox.currentFolder,
    loadFolder: mailbox.loadFolder,
    setSendRemainingToday,
  });

  const settings = useMailboxSettings({
    isSettingsModalOpen,
    currentFolder: mailbox.currentFolder,
    loadFolder: mailbox.loadFolder,
    showToast,
  });

  /**
   * Before switching, the open draft must be saved under the account that owns
   * it: the fetch carries the CURRENT /u/<n>/ header, and only then does the URL
   * change. A draft from account A can therefore never land in account B.
   */
  const prepareForAccountSwitch = useCallback(async () => {
    if (!compose.composeState.isOpen) return;
    compose.saveDraft(compose.composeState.data);
    await compose.flushDrafts();
    compose.closeCompose();
    showToast('Draft saved');
  }, [compose, showToast]);

  const accounts = useAccountsSwitcher({
    showToast,
    currentFolder: mailbox.currentFolder,
    prepareForAccountSwitch,
    resetForAccountSwitch: mailbox.resetForAccountSwitch,
    onSessionChanged,
    onSwitchAccount,
    initial: { activeId, authuser, accounts: initialAccounts, unread: initialUnread },
  });

  // ----- Search -------------------------------------------------------------
  const resetSearch = useCallback(() => {
    setSearchQuery('');
    setSearchFilter(EMPTY_FILTER);
    setIsSearchFilterOpen(false);
  }, []);

  // Search runs on the list already loaded (fast, no extra API calls).
  const filteredEmails = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    const f = searchFilter;
    return mailbox.emails.filter((email) => {
      if (q) {
        const hit =
          email.senderName.toLowerCase().includes(q) ||
          email.senderEmail.toLowerCase().includes(q) ||
          email.subject.toLowerCase().includes(q) ||
          email.snippet.toLowerCase().includes(q) ||
          email.toRecipients.some((r) => r.toLowerCase().includes(q));
        if (!hit) return false;
      }
      if (f.from && !email.senderEmail.toLowerCase().includes(f.from.toLowerCase())) return false;
      if (f.to && !email.toRecipients.some((r) => r.toLowerCase().includes(f.to.toLowerCase()))) return false;
      if (f.subject && !email.subject.toLowerCase().includes(f.subject.toLowerCase())) return false;
      if (f.hasAttachment && email.attachments.length === 0) return false;
      return true;
    });
  }, [mailbox.emails, searchQuery, searchFilter]);

  const currentUser: UserProfile = useMemo(
    () => ({
      username: user.username,
      name: user.name,
      email: user.email,
      avatarText: initials(user.name, user.username),
    }),
    [user]
  );

  const value: MailContextType = {
    emails: mailbox.emails,
    filteredEmails,
    isLoadingEmails: mailbox.isLoadingEmails,
    emailsError: mailbox.emailsError,
    hasMore: mailbox.hasMore,
    isRefreshing: mailbox.isRefreshing,
    unreadInboxCount: mailbox.unreadInboxCount,
    loadMore: mailbox.loadMore,
    refreshEmails: mailbox.refreshEmails,
    prefetchEmail: mailbox.prefetchEmail,
    currentFolder: mailbox.currentFolder,
    setCurrentFolder: mailbox.setCurrentFolder,
    searchQuery,
    setSearchQuery,
    searchFilter,
    setSearchFilter,
    resetSearch,
    selectedEmailId: mailbox.selectedEmailId,
    setSelectedEmailId: mailbox.setSelectedEmailId,
    selectedEmail: mailbox.selectedEmail,
    isLoadingSelected: mailbox.isLoadingSelected,
    selectedIds: mailbox.selectedIds,
    toggleSelectId: mailbox.toggleSelectId,
    selectAllIds: mailbox.selectAllIds,
    clearSelection: mailbox.clearSelection,
    toggleStar: mailbox.toggleStar,
    markAsRead: mailbox.markAsRead,
    deleteEmails: mailbox.deleteEmails,
    sendEmail: compose.sendEmail,
    saveDraft: compose.saveDraft,
    composeState: compose.composeState,
    openCompose: compose.openCompose,
    closeCompose: compose.closeCompose,
    discardCompose: compose.discardCompose,
    minimizeCompose: compose.minimizeCompose,
    maximizeCompose: compose.maximizeCompose,
    setComposeData: compose.setComposeData,
    theme,
    toggleTheme,
    isMobileNavOpen,
    setIsMobileNavOpen,
    isSettingsModalOpen,
    setIsSettingsModalOpen,
    isSearchFilterOpen,
    setIsSearchFilterOpen,
    splitView,
    setSplitView,
    mailboxSettings: settings.mailboxSettings,
    isLoadingSettings: settings.isLoadingSettings,
    settingsError: settings.settingsError,
    refreshSettings: settings.refreshSettings,
    saveRetentionLimit: settings.saveRetentionLimit,
    currentUser,
    sendRemainingToday,
    dailySendLimit,
    accountUrl,
    accounts: accounts.accounts,
    activeAccountId: accounts.activeAccountId,
    accountUnread: accounts.accountUnread,
    accountsUnsupported: accounts.accountsUnsupported,
    isLoadingAccounts: accounts.isLoadingAccounts,
    switchingAccountId: accounts.switchingAccountId,
    refreshAccounts: accounts.refreshAccounts,
    switchAccount: accounts.switchAccount,
    signOutAccount: accounts.signOutAccount,
    addAccountUrl: accounts.addAccountUrl,
    toast,
    dismissToast,
    showToast,
  };

  return <MailContext.Provider value={value}>{children}</MailContext.Provider>;
};

export const useMail = (): MailContextType => {
  const context = React.useContext(MailContext);
  if (!context) {
    throw new Error('useMail must be used within a MailProvider');
  }
  return context;
};

// Re-exported for EmailList: the compose "open a draft" flow and the optimistic
// row it creates before the list refreshes.
export { toComposeData, toEmailMessage };
export type { EmailFolder };
