import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import {
  EmailMessage,
  EmailCategory,
  EmailFolder,
  ComposeData,
  SupabaseConfig,
  UserProfile,
} from '../types/email';
import { INITIAL_EMAILS } from '../data/mockEmails';
import {
  getStoredSupabaseConfig,
  saveStoredSupabaseConfig,
  loadLocalStoredEmails,
  saveLocalStoredEmails,
} from '../services/supabaseService';

export interface SearchFilterOptions {
  from: string;
  to: string;
  subject: string;
  hasAttachment: boolean;
  dateRange: string;
}

interface ToastInfo {
  id: string;
  message: string;
  actionText?: string;
  onAction?: () => void;
}

interface MailContextType {
  emails: EmailMessage[];
  currentFolder: EmailFolder;
  setCurrentFolder: (folder: EmailFolder) => void;
  currentCategory: EmailCategory;
  setCurrentCategory: (cat: EmailCategory) => void;
  selectedLabel: string | null;
  setSelectedLabel: (label: string | null) => void;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  searchFilter: SearchFilterOptions;
  setSearchFilter: (filter: SearchFilterOptions) => void;
  resetSearch: () => void;
  selectedEmailId: string | null;
  setSelectedEmailId: (id: string | null) => void;
  selectedEmail: EmailMessage | null;
  selectedIds: string[];
  toggleSelectId: (id: string) => void;
  selectAllIds: (ids: string[]) => void;
  clearSelection: () => void;
  toggleStar: (id: string) => void;
  markAsRead: (ids: string[], isRead: boolean) => void;
  deleteEmails: (ids: string[]) => void;
  archiveEmails: (ids: string[]) => void;
  snoozeEmails: (ids: string[]) => void;
  moveToFolder: (ids: string[], targetFolder: EmailFolder) => void;
  addLabelToEmails: (ids: string[], label: string) => void;
  removeLabelFromEmails: (ids: string[], label: string) => void;
  sendEmail: (data: ComposeData) => Promise<boolean>;
  saveDraft: (data: ComposeData) => void;
  refreshEmails: () => void;
  isRefreshing: boolean;
  
  // Compose modal state
  composeState: {
    isOpen: boolean;
    isMinimized: boolean;
    isMaximized: boolean;
    data: ComposeData;
  };
  openCompose: (initialData?: Partial<ComposeData>) => void;
  closeCompose: () => void;
  minimizeCompose: () => void;
  maximizeCompose: () => void;
  setComposeData: (data: ComposeData) => void;

  // View & UI Modals
  theme: 'light' | 'dark';
  toggleTheme: () => void;
  isMobileNavOpen: boolean;
  setIsMobileNavOpen: (open: boolean) => void;
  isSupabaseModalOpen: boolean;
  setIsSupabaseModalOpen: (open: boolean) => void;
  isSettingsModalOpen: boolean;
  setIsSettingsModalOpen: (open: boolean) => void;
  isSearchFilterOpen: boolean;
  setIsSearchFilterOpen: (open: boolean) => void;
  splitView: 'none' | 'vertical' | 'horizontal';
  setSplitView: (mode: 'none' | 'vertical' | 'horizontal') => void;
  
  // Custom Labels
  labels: string[];
  createLabel: (name: string) => void;

  // Supabase
  supabaseConfig: SupabaseConfig;
  updateSupabaseConfig: (config: SupabaseConfig) => void;

  // User Profile
  currentUser: UserProfile;

  // Notifications
  toast: ToastInfo | null;
  dismissToast: () => void;
  showToast: (message: string, actionText?: string, onAction?: () => void) => void;

  // Computed counts
  folderCounts: Record<EmailFolder, number>;
  categoryCounts: Record<EmailCategory, number>;
  filteredEmails: EmailMessage[];
}

const MailContext = createContext<MailContextType | null>(null);

const DEFAULT_USER: UserProfile = {
  name: 'Pawan Gothwad',
  email: 'pwngtwd@gmail.com',
  avatarText: 'PG',
  storageUsedGb: 1.2,
  storageTotalGb: 15.0,
};

export const MailProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [emails, setEmails] = useState<EmailMessage[]>(() => loadLocalStoredEmails(INITIAL_EMAILS));
  const [currentFolder, setCurrentFolder] = useState<EmailFolder>('inbox');
  const [currentCategory, setCurrentCategory] = useState<EmailCategory>('primary');
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchFilter, setSearchFilter] = useState<SearchFilterOptions>({
    from: '',
    to: '',
    subject: '',
    hasAttachment: false,
    dateRange: 'all',
  });
  const [isSearchFilterOpen, setIsSearchFilterOpen] = useState(false);
  const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Labels
  const [labels, setLabels] = useState<string[]>([
    'Personal',
    'Work',
    'Supabase Dev',
    'Finance',
    'Travel',
  ]);

  // Modals & responsive state
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const [isSupabaseModalOpen, setIsSupabaseModalOpen] = useState(false);
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

  // Apply theme to document
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

  // Supabase Configuration
  const [supabaseConfig, setSupabaseConfigState] = useState<SupabaseConfig>(() =>
    getStoredSupabaseConfig()
  );

  const updateSupabaseConfig = useCallback((newConfig: SupabaseConfig) => {
    setSupabaseConfigState(newConfig);
    saveStoredSupabaseConfig(newConfig);
  }, []);

  // Toast
  const [toast, setToast] = useState<ToastInfo | null>(null);

  const showToast = useCallback((message: string, actionText?: string, onAction?: () => void) => {
    const id = Date.now().toString();
    setToast({ id, message, actionText, onAction });
    setTimeout(() => {
      setToast((cur) => (cur?.id === id ? null : cur));
    }, 4500);
  }, []);

  const dismissToast = useCallback(() => {
    setToast(null);
  }, []);

  // Compose State
  const [composeState, setComposeState] = useState<{
    isOpen: boolean;
    isMinimized: boolean;
    isMaximized: boolean;
    data: ComposeData;
  }>({
    isOpen: false,
    isMinimized: false,
    isMaximized: false,
    data: {
      to: [],
      cc: [],
      bcc: [],
      subject: '',
      body: '',
      attachments: [],
      category: 'primary',
    },
  });

  const openCompose = useCallback((initialData?: Partial<ComposeData>) => {
    setComposeState((prev) => ({
      ...prev,
      isOpen: true,
      isMinimized: false,
      data: {
        to: initialData?.to || [],
        cc: initialData?.cc || [],
        bcc: initialData?.bcc || [],
        subject: initialData?.subject || '',
        body: initialData?.body || '',
        attachments: initialData?.attachments || [],
        category: initialData?.category || 'primary',
        isScheduled: initialData?.isScheduled || false,
      },
    }));
  }, []);

  const closeCompose = useCallback(() => {
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

  // Persist emails changes locally
  const updateAndSaveEmails = useCallback((updated: EmailMessage[]) => {
    setEmails(updated);
    saveLocalStoredEmails(updated);
  }, []);

  // Actions
  const toggleSelectId = useCallback((id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  }, []);

  const selectAllIds = useCallback((ids: string[]) => {
    setSelectedIds(ids);
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedIds([]);
  }, []);

  const toggleStar = useCallback(
    (id: string) => {
      const updated = emails.map((msg) =>
        msg.id === id ? { ...msg, isStarred: !msg.isStarred } : msg
      );
      updateAndSaveEmails(updated);
    },
    [emails, updateAndSaveEmails]
  );

  const markAsRead = useCallback(
    (ids: string[], isRead: boolean) => {
      const updated = emails.map((msg) =>
        ids.includes(msg.id) ? { ...msg, isRead } : msg
      );
      updateAndSaveEmails(updated);
      showToast(isRead ? 'Marked as read' : 'Marked as unread');
    },
    [emails, updateAndSaveEmails, showToast]
  );

  const deleteEmails = useCallback(
    (ids: string[]) => {
      const prevEmails = [...emails];
      const updated = emails.map((msg) =>
        ids.includes(msg.id)
          ? { ...msg, isDeleted: true, folder: 'trash' as EmailFolder }
          : msg
      );
      updateAndSaveEmails(updated);
      setSelectedIds([]);
      if (selectedEmailId && ids.includes(selectedEmailId)) {
        setSelectedEmailId(null);
      }
      showToast(
        ids.length > 1 ? `${ids.length} conversations moved to Trash` : 'Conversation moved to Trash',
        'Undo',
        () => {
          updateAndSaveEmails(prevEmails);
        }
      );
    },
    [emails, updateAndSaveEmails, selectedEmailId, showToast]
  );

  const archiveEmails = useCallback(
    (ids: string[]) => {
      const prevEmails = [...emails];
      const updated = emails.map((msg) =>
        ids.includes(msg.id)
          ? { ...msg, isArchived: true, folder: 'archive' as EmailFolder }
          : msg
      );
      updateAndSaveEmails(updated);
      setSelectedIds([]);
      if (selectedEmailId && ids.includes(selectedEmailId)) {
        setSelectedEmailId(null);
      }
      showToast(
        ids.length > 1 ? `${ids.length} conversations archived` : 'Conversation archived',
        'Undo',
        () => {
          updateAndSaveEmails(prevEmails);
        }
      );
    },
    [emails, updateAndSaveEmails, selectedEmailId, showToast]
  );

  const snoozeEmails = useCallback(
    (ids: string[]) => {
      const updated = emails.map((msg) =>
        ids.includes(msg.id)
          ? { ...msg, isSnoozed: true, folder: 'snoozed' as EmailFolder }
          : msg
      );
      updateAndSaveEmails(updated);
      setSelectedIds([]);
      showToast(ids.length > 1 ? `${ids.length} conversations snoozed` : 'Conversation snoozed');
    },
    [emails, updateAndSaveEmails, showToast]
  );

  const moveToFolder = useCallback(
    (ids: string[], targetFolder: EmailFolder) => {
      const updated = emails.map((msg) =>
        ids.includes(msg.id) ? { ...msg, folder: targetFolder } : msg
      );
      updateAndSaveEmails(updated);
      setSelectedIds([]);
      showToast(`Moved to ${targetFolder}`);
    },
    [emails, updateAndSaveEmails, showToast]
  );

  const addLabelToEmails = useCallback(
    (ids: string[], label: string) => {
      const updated = emails.map((msg) => {
        if (ids.includes(msg.id)) {
          const currentLabels = msg.labels || [];
          if (!currentLabels.includes(label)) {
            return { ...msg, labels: [...currentLabels, label] };
          }
        }
        return msg;
      });
      updateAndSaveEmails(updated);
      showToast(`Label "${label}" added`);
    },
    [emails, updateAndSaveEmails, showToast]
  );

  const removeLabelFromEmails = useCallback(
    (ids: string[], label: string) => {
      const updated = emails.map((msg) => {
        if (ids.includes(msg.id)) {
          return {
            ...msg,
            labels: (msg.labels || []).filter((l) => l !== label),
          };
        }
        return msg;
      });
      updateAndSaveEmails(updated);
    },
    [emails, updateAndSaveEmails]
  );

  const createLabel = useCallback((name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setLabels((prev) => (prev.includes(trimmed) ? prev : [...prev, trimmed]));
  }, []);

  const sendEmail = useCallback(
    async (data: ComposeData): Promise<boolean> => {
      const newEmail: EmailMessage = {
        id: `msg-${Date.now()}`,
        threadId: `thread-${Date.now()}`,
        senderName: 'Me',
        senderEmail: 'pwngtwd@gmail.com',
        toRecipients: data.to.length > 0 ? data.to : ['contact@example.com'],
        ccRecipients: data.cc,
        bccRecipients: data.bcc,
        subject: data.subject || '(no subject)',
        snippet: data.body ? data.body.substring(0, 90) : '',
        bodyHtml: `
          <div style="font-family: inherit; line-height: 1.6;">
            ${data.body.replace(/\n/g, '<br/>')}
          </div>
        `,
        bodyText: data.body,
        timestamp: new Date().toISOString(),
        dateFormatted: 'Just now',
        isRead: true,
        isStarred: false,
        isSnoozed: false,
        isArchived: false,
        isDeleted: false,
        isDraft: false,
        isSpam: false,
        category: data.category || 'primary',
        folder: data.isScheduled ? 'scheduled' : 'sent',
        labels: ['Work'],
        attachments: data.attachments,
        security: {
          isEncrypted: true,
          spfVerified: true,
          dkimVerified: true,
        },
      };

      const updated = [newEmail, ...emails];
      updateAndSaveEmails(updated);
      closeCompose();
      showToast(
        data.isScheduled ? 'Message scheduled to send' : 'Message sent',
        'View message',
        () => {
          setCurrentFolder(data.isScheduled ? 'scheduled' : 'sent');
          setSelectedEmailId(newEmail.id);
        }
      );
      return true;
    },
    [emails, updateAndSaveEmails, closeCompose, showToast]
  );

  const saveDraft = useCallback(
    (data: ComposeData) => {
      if (!data.subject && !data.body && data.to.length === 0) return;
      const draftId = data.id || `draft-${Date.now()}`;
      const draftEmail: EmailMessage = {
        id: draftId,
        threadId: `thread-${draftId}`,
        senderName: 'Draft',
        senderEmail: 'pwngtwd@gmail.com',
        toRecipients: data.to,
        subject: data.subject ? `Draft: ${data.subject}` : 'Draft (no subject)',
        snippet: data.body ? data.body.substring(0, 90) : 'Draft message',
        bodyHtml: `<div style="font-family: inherit;">${data.body.replace(/\n/g, '<br/>')}</div>`,
        bodyText: data.body,
        timestamp: new Date().toISOString(),
        dateFormatted: 'Draft',
        isRead: true,
        isStarred: false,
        isSnoozed: false,
        isArchived: false,
        isDeleted: false,
        isDraft: true,
        isSpam: false,
        category: data.category || 'primary',
        folder: 'drafts',
        labels: [],
        attachments: data.attachments,
      };

      const filtered = emails.filter((e) => e.id !== draftId);
      updateAndSaveEmails([draftEmail, ...filtered]);
    },
    [emails, updateAndSaveEmails]
  );

  const refreshEmails = useCallback(() => {
    setIsRefreshing(true);
    setTimeout(() => {
      setIsRefreshing(false);
      showToast('Mailbox up to date');
    }, 600);
  }, [showToast]);

  const resetSearch = useCallback(() => {
    setSearchQuery('');
    setSearchFilter({
      from: '',
      to: '',
      subject: '',
      hasAttachment: false,
      dateRange: 'all',
    });
    setIsSearchFilterOpen(false);
  }, []);

  // Filtered Emails computation
  const filteredEmails = useMemo(() => {
    return emails.filter((email) => {
      // 1. Folder check
      if (currentFolder === 'starred') {
        if (!email.isStarred || email.isDeleted) return false;
      } else if (currentFolder === 'snoozed') {
        if (!email.isSnoozed || email.isDeleted) return false;
      } else if (currentFolder === 'sent') {
        if (email.folder !== 'sent' || email.isDeleted) return false;
      } else if (currentFolder === 'drafts') {
        if (!email.isDraft || email.isDeleted) return false;
      } else if (currentFolder === 'important') {
        if (!email.isImportant || email.isDeleted) return false;
      } else if (currentFolder === 'scheduled') {
        if (email.folder !== 'scheduled' || email.isDeleted) return false;
      } else if (currentFolder === 'spam') {
        if (!email.isSpam) return false;
      } else if (currentFolder === 'trash') {
        if (!email.isDeleted) return false;
      } else if (currentFolder === 'archive') {
        if (!email.isArchived || email.isDeleted) return false;
      } else if (currentFolder === 'all') {
        if (email.isDeleted && email.folder !== 'trash') return false;
      } else {
        // Default: 'inbox'
        if (email.folder !== 'inbox' || email.isDeleted || email.isArchived) return false;
        // In inbox, also filter by category unless searching or label selected
        if (!selectedLabel && !searchQuery.trim()) {
          if (email.category !== currentCategory) return false;
        }
      }

      // 2. Custom label filter
      if (selectedLabel) {
        if (!email.labels || !email.labels.includes(selectedLabel)) return false;
      }

      // 3. Search text query
      const q = searchQuery.toLowerCase().trim();
      if (q) {
        const matchesSender = email.senderName.toLowerCase().includes(q) || email.senderEmail.toLowerCase().includes(q);
        const matchesSubject = email.subject.toLowerCase().includes(q);
        const matchesSnippet = email.snippet.toLowerCase().includes(q);
        const matchesBody = email.bodyText.toLowerCase().includes(q);
        const matchesRecipients = email.toRecipients.some((r) => r.toLowerCase().includes(q));
        if (!matchesSender && !matchesSubject && !matchesSnippet && !matchesBody && !matchesRecipients) {
          return false;
        }
      }

      // 4. Advanced search filters
      if (searchFilter.from && !email.senderEmail.toLowerCase().includes(searchFilter.from.toLowerCase())) {
        return false;
      }
      if (searchFilter.to && !email.toRecipients.some((r) => r.toLowerCase().includes(searchFilter.to.toLowerCase()))) {
        return false;
      }
      if (searchFilter.subject && !email.subject.toLowerCase().includes(searchFilter.subject.toLowerCase())) {
        return false;
      }
      if (searchFilter.hasAttachment && (!email.attachments || email.attachments.length === 0)) {
        return false;
      }

      return true;
    });
  }, [emails, currentFolder, currentCategory, selectedLabel, searchQuery, searchFilter]);

  // Compute counts
  const folderCounts = useMemo(() => {
    const counts: Record<EmailFolder, number> = {
      inbox: 0,
      starred: 0,
      snoozed: 0,
      sent: 0,
      drafts: 0,
      important: 0,
      scheduled: 0,
      all: 0,
      spam: 0,
      trash: 0,
      archive: 0,
    };

    emails.forEach((e) => {
      if (!e.isDeleted) {
        if (e.folder === 'inbox' && !e.isArchived && !e.isRead) counts.inbox += 1;
        if (e.isStarred) counts.starred += 1;
        if (e.isSnoozed) counts.snoozed += 1;
        if (e.isDraft) counts.drafts += 1;
        if (e.isImportant) counts.important += 1;
        if (e.folder === 'sent') counts.sent += 1;
        if (e.folder === 'scheduled') counts.scheduled += 1;
        if (e.folder === 'archive') counts.archive += 1;
        counts.all += 1;
      } else {
        counts.trash += 1;
      }
      if (e.isSpam) counts.spam += 1;
    });

    return counts;
  }, [emails]);

  const categoryCounts = useMemo(() => {
    const counts: Record<EmailCategory, number> = {
      primary: 0,
      social: 0,
      promotions: 0,
      updates: 0,
      forums: 0,
    };

    emails.forEach((e) => {
      if (e.folder === 'inbox' && !e.isDeleted && !e.isArchived && !e.isRead) {
        if (counts[e.category] !== undefined) {
          counts[e.category] += 1;
        }
      }
    });

    return counts;
  }, [emails]);

  const selectedEmail = useMemo(() => {
    if (!selectedEmailId) return null;
    return emails.find((e) => e.id === selectedEmailId) || null;
  }, [emails, selectedEmailId]);

  return (
    <MailContext.Provider
      value={{
        emails,
        currentFolder,
        setCurrentFolder,
        currentCategory,
        setCurrentCategory,
        selectedLabel,
        setSelectedLabel,
        searchQuery,
        setSearchQuery,
        searchFilter,
        setSearchFilter,
        resetSearch,
        selectedEmailId,
        setSelectedEmailId,
        selectedEmail,
        selectedIds,
        toggleSelectId,
        selectAllIds,
        clearSelection,
        toggleStar,
        markAsRead,
        deleteEmails,
        archiveEmails,
        snoozeEmails,
        moveToFolder,
        addLabelToEmails,
        removeLabelFromEmails,
        sendEmail,
        saveDraft,
        refreshEmails,
        isRefreshing,
        composeState,
        openCompose,
        closeCompose,
        minimizeCompose,
        maximizeCompose,
        setComposeData,
        theme,
        toggleTheme,
        isMobileNavOpen,
        setIsMobileNavOpen,
        isSupabaseModalOpen,
        setIsSupabaseModalOpen,
        isSettingsModalOpen,
        setIsSettingsModalOpen,
        isSearchFilterOpen,
        setIsSearchFilterOpen,
        splitView,
        setSplitView,
        labels,
        createLabel,
        supabaseConfig,
        updateSupabaseConfig,
        currentUser: DEFAULT_USER,
        toast,
        dismissToast,
        showToast,
        folderCounts,
        categoryCounts,
        filteredEmails,
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
