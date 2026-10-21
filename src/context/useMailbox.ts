// =============================================================================
// The mailbox itself: which folder is open, the list, its caches, the opened
// message, selection and the message actions.
//
// Split out of MailContext.tsx so each file stays small. Behaviour is the same
// code as before — the provider just composes this hook with the others.
// =============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EmailFolder, EmailMessage } from '../types/email';
import { mailApi } from '../services/mailApi';
import { errorText, toEmailMessage } from './mailHelpers';
import { PAGE_SIZE } from './mailContextTypes';
import { folderFromHash, writeFolderToUrl } from '../services/authuser';
import { accountMailboxCache } from '../services/mailboxCache';

/**
 * `accountKey` is the Accounts slot id. Each account's lists and opened messages
 * live in a module-level cache under that key, so switching back to an account
 * paints its last inbox in the same frame instead of waiting for the network.
 */
export function useMailbox({
  showToast,
  accountKey,
}: {
  showToast: (message: string) => void;
  accountKey: string;
}) {
  const [emails, setEmails] = useState<EmailMessage[]>([]);
  const [isLoadingEmails, setIsLoadingEmails] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [emailsError, setEmailsError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);

  // Per-folder memory cache: switching back to a folder shows the last list
  // immediately (no spinner, no request) and then revalidates in the
  // background. The maps come from the per-account cache, so a provider remount
  // after an account switch starts warm for THAT account only.
  const accountCache = accountMailboxCache(accountKey);
  const folderCacheRef = useRef(accountCache.folders);
  const detailCacheRef = useRef(accountCache.details);
  const prefetchingRef = useRef(accountCache.prefetching);
  // The folder is in the URL hash (`/u/1/#sent`), so a refresh lands here.
  const [currentFolder, setCurrentFolderState] = useState<EmailFolder>(() => folderFromHash());

  const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null);
  const [openedMessage, setOpenedMessage] = useState<EmailMessage | null>(null);
  const [isLoadingSelected, setIsLoadingSelected] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // A request counter makes sure an old, slow response never overwrites a newer folder.
  const loadSeqRef = useRef(0);

  const loadFolder = useCallback(
    async (folder: EmailFolder, opts: { force?: boolean } = {}) => {
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
    },
    [showToast]
  );

  useEffect(() => {
    // Paint the cached folder immediately when this account was visited before.
    void loadFolder(currentFolder);
  }, [currentFolder, loadFolder]);

  const refreshEmails = useCallback(() => {
    folderCacheRef.current.delete(currentFolder);
    void loadFolder(currentFolder, { force: true });
  }, [currentFolder, loadFolder]);

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

  const setCurrentFolder = useCallback((folder: EmailFolder) => {
    setCurrentFolderState(folder);
    setSelectedEmailId(null);
    setSelectedIds([]);
    // The URL is the state: /u/<account>/#<folder> survives refresh and sharing.
    writeFolderToUrl(folder);
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

  // Unread badge: only the inbox is counted, and only from what is cached, so
  // the title never lies about a folder the user has not loaded.
  const unreadInboxCount = useMemo(() => {
    const inbox = currentFolder === 'inbox' ? emails : folderCacheRef.current.get('inbox')?.emails ?? [];
    return inbox.filter((e) => !e.isRead).length;
  }, [currentFolder, emails]);

  /**
   * Everything that belongs to the current account. Called before switching
   * accounts: a cache that survived a switch would show one mailbox to another.
   */
  const clearCaches = useCallback(() => {
    folderCacheRef.current.clear();
    detailCacheRef.current.clear();
    prefetchingRef.current.clear();
    loadSeqRef.current += 1; // in-flight list responses must not land either
  }, []);

  const resetForAccountSwitch = useCallback(() => {
    clearCaches();
    setEmails([]);
    setHasMore(false);
    setSelectedEmailId(null);
    setOpenedMessage(null);
    setSelectedIds([]);
  }, [clearCaches]);

  const resetForAccountSignOut = useCallback(() => {
    clearCaches();
    setEmails([]);
    setSelectedEmailId(null);
    setOpenedMessage(null);
  }, [clearCaches]);

  return {
    emails,
    isLoadingEmails,
    isRefreshing,
    emailsError,
    hasMore,
    currentFolder,
    setCurrentFolder,
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
    loadFolder,
    refreshEmails,
    loadMore,
    prefetchEmail,
    unreadInboxCount,
    resetForAccountSwitch,
    resetForAccountSignOut,
  };
}

export type MailboxStore = ReturnType<typeof useMailbox>;
