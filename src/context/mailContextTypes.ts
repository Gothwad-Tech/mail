// =============================================================================
// Types, constants and the React context object for the mail store.
//
// Kept in its own file so the provider, the hooks and the components can all
// import the same contract without importing the whole provider (the provider
// file stays small, and `useMail` is still the single public entry point).
// =============================================================================

import { createContext } from 'react';
import type { ComposeData, EmailFolder, EmailMessage, UserProfile } from '../types/email';
import type {
  AccountSummary,
  MailboxSettings,
  RetentionLimit,
} from '../services/mailApi';

export interface SearchFilterOptions {
  from: string;
  to: string;
  subject: string;
  hasAttachment: boolean;
}

export const EMPTY_FILTER: SearchFilterOptions = { from: '', to: '', subject: '', hasAttachment: false };

export interface ToastInfo {
  id: string;
  message: string;
}

export interface ComposeState {
  isOpen: boolean;
  isMinimized: boolean;
  isMaximized: boolean;
  data: ComposeData;
}

export const EMPTY_COMPOSE: ComposeData = { to: [], cc: [], bcc: [], subject: '', body: '' };

/** How many messages one page holds. */
export const PAGE_SIZE = 50;

export interface MailContextType {
  // Mailbox data (from the Worker API)
  emails: EmailMessage[];
  filteredEmails: EmailMessage[];
  isLoadingEmails: boolean;
  emailsError: string | null;
  hasMore: boolean;
  /** True while a background revalidation runs over an already-shown list. */
  isRefreshing: boolean;
  unreadInboxCount: number;
  loadMore: () => void;
  refreshEmails: () => void;
  /** Warm the detail cache (hover / touch) so opening feels instant. */
  prefetchEmail: (id: string) => void;

  currentFolder: EmailFolder;
  setCurrentFolder: (folder: EmailFolder) => void;

  searchQuery: string;
  setSearchQuery: (q: string) => void;
  searchFilter: SearchFilterOptions;
  setSearchFilter: (filter: SearchFilterOptions) => void;
  resetSearch: () => void;

  selectedEmailId: string | null;
  setSelectedEmailId: (id: string | null) => void;
  selectedEmail: EmailMessage | null;
  isLoadingSelected: boolean;
  selectedIds: string[];
  toggleSelectId: (id: string) => void;
  selectAllIds: (ids: string[]) => void;
  clearSelection: () => void;

  toggleStar: (id: string) => void;
  markAsRead: (ids: string[], isRead: boolean) => void;
  /** In Inbox/Sent/Drafts: move to Trash. In Trash: delete forever. */
  deleteEmails: (ids: string[]) => void;

  sendEmail: (data: ComposeData) => Promise<boolean>;
  saveDraft: (data: ComposeData) => void;

  // Compose modal state
  composeState: ComposeState;
  openCompose: (initialData?: Partial<ComposeData>) => void;
  /** Close the compose window and keep the draft (it stays in Drafts). */
  closeCompose: () => void;
  /** Close and delete the draft on the server. */
  discardCompose: () => void;
  minimizeCompose: () => void;
  maximizeCompose: () => void;
  setComposeData: (data: ComposeData) => void;

  // View & UI modals
  theme: 'light' | 'dark';
  toggleTheme: () => void;
  isMobileNavOpen: boolean;
  setIsMobileNavOpen: (open: boolean) => void;
  isSettingsModalOpen: boolean;
  setIsSettingsModalOpen: (open: boolean) => void;
  isSearchFilterOpen: boolean;
  setIsSearchFilterOpen: (open: boolean) => void;
  splitView: 'none' | 'vertical' | 'horizontal';
  setSplitView: (mode: 'none' | 'vertical' | 'horizontal') => void;

  // Mailbox storage + retention (Cloudflare D1)
  mailboxSettings: MailboxSettings | null;
  isLoadingSettings: boolean;
  settingsError: string | null;
  refreshSettings: () => void;
  saveRetentionLimit: (limit: RetentionLimit) => Promise<boolean>;

  // Signed-in user (from the Accounts session, via the Worker)
  currentUser: UserProfile;
  sendRemainingToday: number | null;
  dailySendLimit: number | null;
  accountUrl: string;
  /** This tab's account index (/u/<n>/). */
  authuser: number;
  /** Accounts web origin from the session; '' if the Worker did not send one. */
  accountsWebOrigin: string;

  // Account switcher (multiple signed-in Gothwad accounts)
  accounts: AccountSummary[];
  activeAccountId: string | null;
  accountUnread: Record<string, number>;
  /** Accounts has not deployed the multi-account API yet: hide the switcher. */
  accountsUnsupported: boolean;
  isLoadingAccounts: boolean;
  /** Slot id currently being switched or signed out (row spinner). */
  switchingAccountId: string | null;
  refreshAccounts: () => void;
  switchAccount: (id: string) => Promise<boolean>;
  signOutAccount: (id: string) => Promise<void>;
  /** Signs every account out; the session check then sends the browser away. */
  signOutAllAccounts: () => Promise<void>;
  /** Link to Accounts' sign-in page in "add another account" mode. */
  addAccountUrl: string;

  // Notifications
  toast: ToastInfo | null;
  dismissToast: () => void;
  showToast: (message: string) => void;
}

export const MailContext = createContext<MailContextType | null>(null);
