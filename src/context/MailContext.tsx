import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { EmailMessage, EmailFolder, ComposeData, UserProfile } from '../types/email';
import {
  ApiMessage,
  ApiError,
  mailApi,
  SessionUser,
  MailboxSettings,
  RetentionLimit,
  AccountSummary,
  AccountsInfo,
} from '../services/mailApi';

export interface SearchFilterOptions {
  from: string;
  to: string;
  subject: string;
  hasAttachment: boolean;
}

const EMPTY_FILTER: SearchFilterOptions = { from: '', to: '', subject: '', hasAttachment: false };

interface ToastInfo {
  id: string;
  message: string;
}

export interface ComposeState {
  isOpen: boolean;
  isMinimized: boolean;
  isMaximized: boolean;
  data: ComposeData;
}

const EMPTY_COMPOSE: ComposeData = { to: [], cc: [], bcc: [], subject: '', body: '' };

interface MailContextType {
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
  /** Link to Accounts' sign-in page in "add another account" mode. */
  addAccountUrl: string;

  // Notifications
  toast: ToastInfo | null;
  dismissToast: () => void;
  showToast: (message: string) => void;
}

const MailContext = createContext<MailContextType | null>(null);

const PAGE_SIZE = 50;

function initials(name: string | null, username: string): string {
  const source = (name && name.trim()) || username;
  const parts = source.split(/[\s._-]+/).filter(Boolean);
  const letters = parts.length >= 2 ? parts[0][0] + parts[1][0] : source.slice(0, 2);
  return letters.toUpperCase();
}

function formatListDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Map the API shape to the shape the UI components use. */
export function toEmailMessage(m: ApiMessage): EmailMessage {
  return {
    id: m.id,
    senderName: m.from.name || m.from.email,
    senderEmail: m.from.email,
    toRecipients: m.to,
    ccRecipients: m.cc,
    bccRecipients: m.bcc,
    subject: m.subject,
    snippet: m.snippet,
    bodyHtml: m.bodyHtml ?? '',
    bodyText: m.bodyText ?? '',
    timestamp: m.receivedAt,
    dateFormatted: formatListDate(m.receivedAt),
    isRead: m.isRead,
    isStarred: m.isStarred,
    isDraft: m.folder === 'drafts',
    folder: m.folder,
    attachments: m.attachments.map((a) => ({ name: a.name, size: formatBytes(a.size), type: a.type })),
  };
}

function toComposeData(m: EmailMessage): ComposeData {
  return {
    id: m.id,
    to: m.toRecipients,
    cc: m.ccRecipients,
    bcc: m.bccRecipients,
    subject: m.subject,
    body: m.bodyText,
  };
}

function errorText(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return 'Something went wrong. Please try again.';
}

export const MailProvider: React.FC<{
  user: SessionUser;
  sendRemainingToday: number | null;
  dailySendLimit: number | null;
  accountUrl: string;
  /** Re-reads /api/session after the active account changed. */
  onSessionChanged: () => Promise<void>;
  children: React.ReactNode;
}> = ({
  user,
  sendRemainingToday: initialRemaining,
  dailySendLimit,
  accountUrl,
  onSessionChanged,
  children,
}) => {
  // ----- Mailbox state -------------------------------------------------------
  const [emails, setEmails] = useState<EmailMessage[]>([]);
  const [isLoadingEmails, setIsLoadingEmails] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [emailsError, setEmailsError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);

  // Per-folder memory cache: switching back to a folder shows the last list
  // immediately (no spinner, no request) and then revalidates in the
  // background. Kept in refs so a background refresh never re-renders twice.
  const folderCacheRef = useRef(
    new Map<EmailFolder, { emails: EmailMessage[]; hasMore: boolean; at: number }>()
  );
  const detailCacheRef = useRef(new Map<string, EmailMessage>());
  const prefetchingRef = useRef(new Set<string>());
  const [currentFolder, setCurrentFolderState] = useState<EmailFolder>('inbox');
  const [sendRemainingToday, setSendRemainingToday] = useState<number | null>(initialRemaining);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchFilter, setSearchFilter] = useState<SearchFilterOptions>(EMPTY_FILTER);
  const [isSearchFilterOpen, setIsSearchFilterOpen] = useState(false);

  const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null);
  const [openedMessage, setOpenedMessage] = useState<EmailMessage | null>(null);
  const [isLoadingSelected, setIsLoadingSelected] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // ----- UI state ------------------------------------------------------------
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [splitView, setSplitView] = useState<'none' | 'vertical' | 'horizontal'>('none');

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

  // ----- Mailbox settings (retention + storage) ------------------------------
  const [mailboxSettings, setMailboxSettings] = useState<MailboxSettings | null>(null);
  const [isLoadingSettings, setIsLoadingSettings] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);

  // ----- Compose state -------------------------------------------------------
  const [composeState, setComposeState] = useState<ComposeState>({
    isOpen: false,
    isMinimized: false,
    isMaximized: false,
    data: EMPTY_COMPOSE,
  });

  // Refs used by the draft saver. They avoid stale closures in timers.
  const composeOpenRef = useRef(false);
  const draftIdRef = useRef<string | null>(null);
  const lastDraftKeyRef = useRef<string>('');
  const pendingDraftRef = useRef<ComposeData | null>(null);
  const draftFlushingRef = useRef(false);

  const openCompose = useCallback((initialData?: Partial<ComposeData>) => {
    composeOpenRef.current = true;
    draftIdRef.current = initialData?.id ?? null;
    lastDraftKeyRef.current = JSON.stringify({ ...EMPTY_COMPOSE, ...initialData, id: undefined });
    setComposeState({
      isOpen: true,
      isMinimized: false,
      isMaximized: false,
      data: {
        id: initialData?.id,
        to: initialData?.to || [],
        cc: initialData?.cc || [],
        bcc: initialData?.bcc || [],
        subject: initialData?.subject || '',
        body: initialData?.body || '',
      },
    });
  }, []);

  const closeCompose = useCallback(() => {
    composeOpenRef.current = false;
    pendingDraftRef.current = null;
    draftIdRef.current = null;
    lastDraftKeyRef.current = '';
    setComposeState((prev) => ({ ...prev, isOpen: false }));
  }, []);

  const minimizeCompose = useCallback(() => {
    setComposeState((prev) => ({ ...prev, isMinimized: !prev.isMinimized }));
  }, []);

  const maximizeCompose = useCallback(() => {
    setComposeState((prev) => ({ ...prev, isMaximized: !prev.isMaximized }));
  }, []);

  const setComposeData = useCallback((data: ComposeData) => {
    setComposeState((prev) => ({ ...prev, data }));
  }, []);

  // ----- Loading the mailbox -------------------------------------------------
  // A request counter makes sure an old, slow response never overwrites a newer folder.
  const loadSeqRef = useRef(0);

  const loadFolder = useCallback(async (folder: EmailFolder, opts: { force?: boolean } = {}) => {
    const seq = ++loadSeqRef.current;
    const cached = folderCacheRef.current.get(folder);
    // Cache hit: paint it now, then revalidate quietly. Only a cold folder shows
    // the full-page loading state, which is what makes browsing feel instant.
    if (cached) {
      setEmails(cached.emails);
      setHasMore(cached.hasMore);
      setEmailsError(null);
      setIsLoadingEmails(false);
      setIsRefreshing(true);
    } else {
      setEmails([]);
      setHasMore(false);
      setEmailsError(null);
      setIsLoadingEmails(true);
      setIsRefreshing(false);
    }
    try {
      const res = await mailApi.listMessages(folder, { limit: PAGE_SIZE });
      if (seq !== loadSeqRef.current) return;
      const next = res.messages.map(toEmailMessage);
      setEmails(next);
      setHasMore(res.nextBefore !== null);
      folderCacheRef.current.set(folder, { emails: next, hasMore: res.nextBefore !== null, at: Date.now() });
    } catch (err) {
      if (seq !== loadSeqRef.current) return;
      // A failed revalidation keeps the cached list: stale beats an empty inbox.
      if (!cached) {
        setEmails([]);
        setHasMore(false);
        setEmailsError(errorText(err));
      } else {
        showToast(errorText(err));
      }
    } finally {
      if (seq === loadSeqRef.current) {
        setIsLoadingEmails(false);
        setIsRefreshing(false);
      }
    }
  }, [showToast]);

  useEffect(() => {
    void loadFolder(currentFolder);
  }, [currentFolder, loadFolder]);

  const refreshEmails = useCallback(() => {
    folderCacheRef.current.delete(currentFolder);
    void loadFolder(currentFolder, { force: true });
  }, [currentFolder, loadFolder]);

  // ----- Account switcher ----------------------------------------------------
  // The list itself lives in Accounts (one session per account there). Mail only
  // mirrors it for the UI and adds the unread counts from its own D1.
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

  /**
   * Everything that belongs to the old account must be gone before the next
   * paint. The provider is also keyed by username in App, so this is belt and
   * braces: a cache that survived a switch would show one mailbox to another.
   */
  const clearAccountCaches = useCallback(() => {
    folderCacheRef.current.clear();
    detailCacheRef.current.clear();
    prefetchingRef.current.clear();
    loadSeqRef.current += 1; // in-flight list responses must not land either
  }, []);

  /** Resolves true when the active account really changed. */
  const switchAccount = useCallback(
    async (id: string): Promise<boolean> => {
      if (id === activeAccountId) return true;
      setSwitchingAccountId(id);
      try {
        const info = await mailApi.switchAccount(id);
        applyAccounts(info);
        clearAccountCaches();
        setEmails([]);
        setHasMore(false);
        setSelectedEmailId(null);
        setOpenedMessage(null);
        setSelectedIds([]);
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
    [
      activeAccountId,
      applyAccounts,
      clearAccountCaches,
      closeCompose,
      onSessionChanged,
      refreshAccounts,
      showToast,
    ]
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
          clearAccountCaches();
          setEmails([]);
          setSelectedEmailId(null);
          setOpenedMessage(null);
          await onSessionChanged();
        }
      } catch (err) {
        showToast(errorText(err));
      } finally {
        setSwitchingAccountId(null);
      }
    },
    [activeAccountId, applyAccounts, clearAccountCaches, onSessionChanged, showToast]
  );

  const loadMore = useCallback(async () => {
    const last = emails[emails.length - 1];
    if (!last || isLoadingEmails) return;
    setIsLoadingEmails(true);
    try {
      const res = await mailApi.listMessages(currentFolder, { limit: PAGE_SIZE, before: last.timestamp });
      setEmails((prev) => [...prev, ...res.messages.map(toEmailMessage)]);
      setHasMore(res.nextBefore !== null);
    } catch (err) {
      showToast(errorText(err));
    } finally {
      setIsLoadingEmails(false);
    }
  }, [emails, isLoadingEmails, currentFolder, showToast]);

  const refreshSettings = useCallback(async () => {
    setIsLoadingSettings(true);
    setSettingsError(null);
    try {
      setMailboxSettings(await mailApi.getSettings());
    } catch (err) {
      setSettingsError(errorText(err));
    } finally {
      setIsLoadingSettings(false);
    }
  }, []);

  // Load usage the first time the Settings panel opens, and again on demand.
  useEffect(() => {
    if (isSettingsModalOpen) void refreshSettings();
  }, [isSettingsModalOpen, refreshSettings]);

  const saveRetentionLimit = useCallback(
    async (limit: RetentionLimit): Promise<boolean> => {
      setIsLoadingSettings(true);
      setSettingsError(null);
      try {
        const next = await mailApi.updateSettings(limit);
        setMailboxSettings(next);
        const { trimmed, trashPurged } = next.cleanup;
        if (trimmed > 0 || trashPurged > 0) {
          showToast(
            `Retention updated: ${trimmed} old email${trimmed === 1 ? '' : 's'} removed` +
              (trashPurged > 0 ? `, ${trashPurged} from Trash` : '') +
              '. Starred emails and drafts were kept.'
          );
        } else {
          showToast('Retention updated.');
        }
        // Messages may have been trimmed, so refresh the list that is on screen.
        void loadFolder(currentFolder);
        return true;
      } catch (err) {
        setSettingsError(errorText(err));
        return false;
      } finally {
        setIsLoadingSettings(false);
      }
    },
    [currentFolder, loadFolder, showToast]
  );

  const discardCompose = useCallback(() => {
    const id = draftIdRef.current;
    closeCompose();
    if (id) {
      mailApi.deleteDraft(id).catch(() => undefined);
      if (currentFolder === 'drafts') void loadFolder('drafts');
    }
  }, [closeCompose, currentFolder, loadFolder]);

  const setCurrentFolder = useCallback((folder: EmailFolder) => {
    setCurrentFolderState(folder);
    setSelectedEmailId(null);
    setSelectedIds([]);
  }, []);

  // ----- Opening a message ---------------------------------------------------
  // Warm the detail cache without showing anything. Hovering a row on desktop or
  // touching it on mobile usually means "I'm about to open this".
  const prefetchEmail = useCallback((id: string) => {
    if (detailCacheRef.current.has(id) || prefetchingRef.current.has(id)) return;
    prefetchingRef.current.add(id);
    mailApi
      .getMessage(id)
      .then(({ message }) => detailCacheRef.current.set(id, toEmailMessage(message)))
      .catch(() => undefined)
      .finally(() => prefetchingRef.current.delete(id));
  }, []);

  useEffect(() => {
    if (!selectedEmailId) {
      setOpenedMessage(null);
      setIsLoadingSelected(false);
      return;
    }
    let cancelled = false;
    // Paint the cached copy instantly, then refresh it in the background.
    const cachedDetail = detailCacheRef.current.get(selectedEmailId);
    setOpenedMessage(cachedDetail ?? null);
    setIsLoadingSelected(!cachedDetail);
    mailApi
      .getMessage(selectedEmailId)
      .then(({ message }) => {
        if (cancelled) return;
        const full = toEmailMessage(message);
        detailCacheRef.current.set(full.id, full);
        setOpenedMessage(full);
        setEmails((prev) => prev.map((e) => (e.id === full.id ? { ...e, isRead: full.isRead } : e)));
        // Opening a message marks it read (same as most mail apps).
        if (!message.isRead && message.folder !== 'drafts') {
          mailApi.patchMessage(message.id, { isRead: true }).catch(() => undefined);
          setOpenedMessage((prev) => (prev ? { ...prev, isRead: true } : prev));
          setEmails((prev) => prev.map((e) => (e.id === full.id ? { ...e, isRead: true } : e)));
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) showToast(errorText(err));
      })
      .finally(() => {
        if (!cancelled) setIsLoadingSelected(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedEmailId, showToast]);

  const selectedEmail = useMemo(() => {
    if (!selectedEmailId) return null;
    if (openedMessage && openedMessage.id === selectedEmailId) return openedMessage;
    return emails.find((e) => e.id === selectedEmailId) ?? null;
  }, [selectedEmailId, openedMessage, emails]);

  // ----- Selection -----------------------------------------------------------
  const toggleSelectId = useCallback((id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  }, []);

  const selectAllIds = useCallback((ids: string[]) => setSelectedIds(ids), []);
  const clearSelection = useCallback(() => setSelectedIds([]), []);

  // ----- Message actions -----------------------------------------------------
  const removeFromList = useCallback((ids: string[]) => {
    setEmails((prev) => prev.filter((e) => !ids.includes(e.id)));
    setSelectedIds((prev) => prev.filter((id) => !ids.includes(id)));
    setSelectedEmailId((cur) => (cur && ids.includes(cur) ? null : cur));
  }, []);

  const toggleStar = useCallback(
    (id: string) => {
      const current = emails.find((e) => e.id === id) ?? (openedMessage?.id === id ? openedMessage : null);
      if (!current) return;
      const next = !current.isStarred;
      const apply = (value: boolean) => {
        setEmails((prev) => prev.map((e) => (e.id === id ? { ...e, isStarred: value } : e)));
        setOpenedMessage((prev) => (prev && prev.id === id ? { ...prev, isStarred: value } : prev));
        const cachedDetail = detailCacheRef.current.get(id);
        if (cachedDetail) detailCacheRef.current.set(id, { ...cachedDetail, isStarred: value });
      };
      apply(next);
      mailApi.patchMessage(id, { isStarred: next }).catch((err: unknown) => {
        apply(!next);
        showToast(errorText(err));
      });
      // In the Starred view an unstarred mail should leave the list.
      if (!next && currentFolder === 'starred') removeFromList([id]);
    },
    [emails, openedMessage, currentFolder, showToast, removeFromList]
  );

  const markAsRead = useCallback(
    (ids: string[], isRead: boolean) => {
      setEmails((prev) => prev.map((e) => (ids.includes(e.id) ? { ...e, isRead } : e)));
      setOpenedMessage((prev) => (prev && ids.includes(prev.id) ? { ...prev, isRead } : prev));
      Promise.all(ids.map((id) => mailApi.patchMessage(id, { isRead }))).catch((err: unknown) => {
        showToast(errorText(err));
        void loadFolder(currentFolder);
      });
      setSelectedIds([]);
      showToast(isRead ? 'Marked as read' : 'Marked as unread');
    },
    [currentFolder, loadFolder, showToast]
  );

  const deleteEmails = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;
      if (currentFolder === 'trash') {
        const ok = window.confirm(
          ids.length > 1 ? `Delete ${ids.length} messages forever? This cannot be undone.` : 'Delete this message forever? This cannot be undone.'
        );
        if (!ok) return;
        removeFromList(ids);
        Promise.all(ids.map((id) => mailApi.deleteTrashed(id))).catch((err: unknown) => {
          showToast(errorText(err));
          void loadFolder(currentFolder);
        });
        showToast(ids.length > 1 ? `${ids.length} messages deleted` : 'Message deleted');
        return;
      }
      removeFromList(ids);
      Promise.all(ids.map((id) => mailApi.patchMessage(id, { moveToTrash: true }))).catch((err: unknown) => {
        showToast(errorText(err));
        void loadFolder(currentFolder);
      });
      showToast(ids.length > 1 ? `${ids.length} conversations moved to Trash` : 'Conversation moved to Trash');
    },
    [currentFolder, loadFolder, removeFromList, showToast]
  );

  // ----- Compose: send and draft ---------------------------------------------
  const sendEmail = useCallback(
    async (data: ComposeData): Promise<boolean> => {
      if (data.to.length === 0) {
        showToast('Add at least one recipient.');
        return false;
      }
      try {
        const res = await mailApi.send({
          to: data.to,
          cc: data.cc,
          bcc: data.bcc,
          subject: data.subject,
          body: data.body,
          draftId: data.id ?? draftIdRef.current ?? undefined,
        });
        setSendRemainingToday(res.remainingToday);
        closeCompose();
        showToast('Message sent');
        if (currentFolder === 'sent' || currentFolder === 'drafts') void loadFolder(currentFolder);
        return true;
      } catch (err) {
        showToast(errorText(err));
        return false;
      }
    },
    [closeCompose, currentFolder, loadFolder, showToast]
  );

  /**
   * Autosave. ComposeModal calls this on every change (debounced there).
   * We only send a request when something actually changed, and we never run
   * two saves at once, so a fast typist cannot create duplicate drafts.
   */
  const flushDrafts = useCallback(async () => {
    if (draftFlushingRef.current) return;
    draftFlushingRef.current = true;
    try {
      while (pendingDraftRef.current) {
        const data = pendingDraftRef.current;
        pendingDraftRef.current = null;
        if (!composeOpenRef.current) break;

        const key = JSON.stringify({ ...data, id: undefined });
        if (key === lastDraftKeyRef.current) continue;

        const isEmpty =
          !data.subject.trim() && !data.body.trim() && data.to.length === 0 && data.cc.length === 0 && data.bcc.length === 0;
        if (isEmpty) {
          // Empty compose: remove the draft we made earlier, if any.
          if (draftIdRef.current) {
            const id = draftIdRef.current;
            draftIdRef.current = null;
            await mailApi.deleteDraft(id).catch(() => undefined);
          }
          lastDraftKeyRef.current = key;
          continue;
        }

        try {
          const { message } = await mailApi.saveDraft({ ...data, id: data.id ?? draftIdRef.current ?? undefined });
          draftIdRef.current = message.id;
          lastDraftKeyRef.current = key;
          setComposeState((prev) => (prev.isOpen ? { ...prev, data: { ...prev.data, id: message.id } } : prev));
        } catch (err) {
          // Keep the text in the compose window. Show the error once.
          showToast(errorText(err));
        }
      }
    } finally {
      draftFlushingRef.current = false;
    }
  }, [showToast]);

  const saveDraft = useCallback(
    (data: ComposeData) => {
      if (!composeOpenRef.current) return;
      pendingDraftRef.current = data;
      void flushDrafts();
    },
    [flushDrafts]
  );

  // ----- Search --------------------------------------------------------------
  const resetSearch = useCallback(() => {
    setSearchQuery('');
    setSearchFilter(EMPTY_FILTER);
    setIsSearchFilterOpen(false);
  }, []);

  // Search runs on the list already loaded (fast, no extra API calls).
  const filteredEmails = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    const f = searchFilter;
    return emails.filter((email) => {
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
  }, [emails, searchQuery, searchFilter]);

  // Unread badge: only the inbox is counted, and only from what is cached, so
  // the title never lies about a folder the user has not loaded.
  const unreadInboxCount = useMemo(() => {
    const inbox = currentFolder === 'inbox' ? emails : folderCacheRef.current.get('inbox')?.emails ?? [];
    return inbox.filter((e) => !e.isRead).length;
  }, [currentFolder, emails]);

  const currentUser: UserProfile = useMemo(
    () => ({
      username: user.username,
      name: user.name,
      email: user.email,
      avatarText: initials(user.name, user.username),
    }),
    [user]
  );

  return (
    <MailContext.Provider
      value={{
        emails,
        filteredEmails,
        isLoadingEmails,
        emailsError,
        hasMore,
        isRefreshing,
        unreadInboxCount,
        loadMore,
        refreshEmails,
        prefetchEmail,
        currentFolder,
        setCurrentFolder,
        searchQuery,
        setSearchQuery,
        searchFilter,
        setSearchFilter,
        resetSearch,
        selectedEmailId,
        setSelectedEmailId,
        selectedEmail,
        isLoadingSelected,
        selectedIds,
        toggleSelectId,
        selectAllIds,
        clearSelection,
        toggleStar,
        markAsRead,
        deleteEmails,
        sendEmail,
        saveDraft,
        composeState,
        openCompose,
        closeCompose,
        discardCompose,
        minimizeCompose,
        maximizeCompose,
        setComposeData,
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
        mailboxSettings,
        isLoadingSettings,
        settingsError,
        refreshSettings,
        saveRetentionLimit,
        currentUser,
        sendRemainingToday,
        dailySendLimit,
        accountUrl,
        accounts,
        activeAccountId,
        accountUnread,
        accountsUnsupported,
        isLoadingAccounts,
        switchingAccountId,
        refreshAccounts,
        switchAccount,
        signOutAccount,
        addAccountUrl: '/api/mail/accounts/add',
        toast,
        dismissToast,
        showToast,
      }}
    >
      {children}
    </MailContext.Provider>
  );
};

export const useMail = (): MailContextType => {
  const context = useContext(MailContext);
  if (!context) {
    throw new Error('useMail must be used within a MailProvider');
  }
  return context;
};

// Exported for the compose "open a draft" flow in EmailList.
export { toComposeData };
