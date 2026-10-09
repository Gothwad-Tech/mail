import React, { useState } from 'react';
import {
  Square,
  CheckSquare,
  MinusSquare,
  RefreshCw,
  Archive,
  Trash2,
  Mail,
  MailOpen,
  Clock,
  Star,
  Tag,
  Paperclip,
  ChevronLeft,
  ChevronRight,
  Inbox,
  Users,
  BadgePercent,
  Info,
  MessageSquare,
  FolderInput,
  Columns,
  Check,
  X,
  MoreVertical,
} from 'lucide-react';
import { useMail } from '../context/MailContext';
import { EmailCategory, EmailFolder, EmailMessage } from '../types/email';

export const EmailList: React.FC = () => {
  const {
    filteredEmails,
    currentFolder,
    currentCategory,
    setCurrentCategory,
    selectedLabel,
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
    selectedEmailId,
    setSelectedEmailId,
    refreshEmails,
    isRefreshing,
    categoryCounts,
    splitView,
    setSplitView,
    labels,
    searchQuery,
  } = useMail();

  const [isSelectMenuOpen, setIsSelectMenuOpen] = useState(false);
  const [isMoveMenuOpen, setIsMoveMenuOpen] = useState(false);
  const [isLabelMenuOpen, setIsLabelMenuOpen] = useState(false);
  const [isMobileMoreOpen, setIsMobileMoreOpen] = useState(false);

  // Category Tabs Configuration
  const categoryTabs: Array<{
    category: EmailCategory;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    count: number;
  }> = [
    { category: 'primary', label: 'Primary', icon: Inbox, count: categoryCounts.primary },
    { category: 'social', label: 'Social', icon: Users, count: categoryCounts.social },
    {
      category: 'promotions',
      label: 'Promotions',
      icon: BadgePercent,
      count: categoryCounts.promotions,
    },
    { category: 'updates', label: 'Updates', icon: Info, count: categoryCounts.updates },
    { category: 'forums', label: 'Forums', icon: MessageSquare, count: categoryCounts.forums },
  ];

  const allFilteredIds = filteredEmails.map((e) => e.id);
  const allSelected = allFilteredIds.length > 0 && allFilteredIds.every((id) => selectedIds.includes(id));
  const someSelected = selectedIds.length > 0 && !allSelected;

  const handleSelectAllDropdown = (type: 'all' | 'none' | 'read' | 'unread' | 'starred' | 'unstarred') => {
    setIsSelectMenuOpen(false);
    if (type === 'all') {
      selectAllIds(allFilteredIds);
    } else if (type === 'none') {
      clearSelection();
    } else if (type === 'read') {
      selectAllIds(filteredEmails.filter((e) => e.isRead).map((e) => e.id));
    } else if (type === 'unread') {
      selectAllIds(filteredEmails.filter((e) => !e.isRead).map((e) => e.id));
    } else if (type === 'starred') {
      selectAllIds(filteredEmails.filter((e) => e.isStarred).map((e) => e.id));
    } else if (type === 'unstarred') {
      selectAllIds(filteredEmails.filter((e) => !e.isStarred).map((e) => e.id));
    }
  };

  const handleToggleSelectAllCheckbox = () => {
    if (allSelected || someSelected) {
      clearSelection();
    } else {
      selectAllIds(allFilteredIds);
    }
  };

  const handleEmailClick = (email: EmailMessage) => {
    setSelectedEmailId(email.id);
    if (!email.isRead) {
      markAsRead([email.id], true);
    }
  };

  const anySelected = selectedIds.length > 0;

  return (
    <div className="flex-1 flex flex-col h-full bg-white dark:bg-[#212121] overflow-hidden select-none">
      {/* =========================================================================
          TOOLBAR (Adapts cleanly: Selection Bar on Mobile vs Desktop Bar)
      ========================================================================= */}
      {anySelected ? (
        /* Contextual Multi-Selection Bar (Mobile & Desktop) */
        <div className="h-12 border-b border-[#0494f4]/30 bg-[#0494f4]/10 dark:bg-[#0494f4]/15 px-3 sm:px-4 flex items-center justify-between shrink-0 transition-colors">
          <div className="flex items-center gap-2">
            <button
              onClick={clearSelection}
              className="p-1.5 rounded-full hover:bg-black/10 dark:hover:bg-white/10 text-neutral-700 dark:text-neutral-200"
              aria-label="Clear selection"
            >
              <X className="w-5 h-5" />
            </button>
            <span className="text-sm font-bold text-[#0494f4] tabular-nums">
              {selectedIds.length} selected
            </span>
          </div>

          <div className="flex items-center gap-1 sm:gap-2">
            <button
              onClick={() => archiveEmails(selectedIds)}
              className="p-2 rounded-full hover:bg-black/10 dark:hover:bg-white/10 text-neutral-700 dark:text-neutral-200"
              title="Archive"
            >
              <Archive className="w-4 h-4" />
            </button>
            <button
              onClick={() => deleteEmails(selectedIds)}
              className="p-2 rounded-full hover:bg-black/10 dark:hover:bg-white/10 text-neutral-700 dark:text-neutral-200"
              title="Delete"
            >
              <Trash2 className="w-4 h-4" />
            </button>
            <button
              onClick={() => markAsRead(selectedIds, true)}
              className="p-2 rounded-full hover:bg-black/10 dark:hover:bg-white/10 text-neutral-700 dark:text-neutral-200"
              title="Mark read"
            >
              <MailOpen className="w-4 h-4" />
            </button>
            <button
              onClick={() => markAsRead(selectedIds, false)}
              className="p-2 rounded-full hover:bg-black/10 dark:hover:bg-white/10 text-neutral-700 dark:text-neutral-200"
              title="Mark unread"
            >
              <Mail className="w-4 h-4" />
            </button>

            {/* Mobile Overflow Menu */}
            <div className="relative">
              <button
                onClick={() => setIsMobileMoreOpen(!isMobileMoreOpen)}
                className="p-2 rounded-full hover:bg-black/10 dark:hover:bg-white/10 text-neutral-700 dark:text-neutral-200"
              >
                <MoreVertical className="w-4 h-4" />
              </button>

              {isMobileMoreOpen && (
                <div className="absolute right-0 top-10 w-44 bg-white dark:bg-[#262626] border border-neutral-200 dark:border-[#383838] rounded-xl shadow-xl py-1 z-50 text-xs">
                  <button
                    onClick={() => {
                      snoozeEmails(selectedIds);
                      setIsMobileMoreOpen(false);
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-neutral-100 dark:hover:bg-[#333333] flex items-center gap-2"
                  >
                    <Clock className="w-3.5 h-3.5" />
                    <span>Snooze</span>
                  </button>
                  <button
                    onClick={() => {
                      moveToFolder(selectedIds, 'trash');
                      setIsMobileMoreOpen(false);
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-neutral-100 dark:hover:bg-[#333333] flex items-center gap-2"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Move to Trash</span>
                  </button>
                  <button
                    onClick={() => {
                      moveToFolder(selectedIds, 'archive');
                      setIsMobileMoreOpen(false);
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-neutral-100 dark:hover:bg-[#333333] flex items-center gap-2"
                  >
                    <Archive className="w-3.5 h-3.5" />
                    <span>Move to Archive</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        /* Standard Header Toolbar */
        <div className="h-12 border-b border-neutral-200 dark:border-[#333333] px-3 sm:px-4 flex items-center justify-between shrink-0 bg-white dark:bg-[#212121]">
          {/* Left Toolbar */}
          <div className="flex items-center gap-1 sm:gap-2">
            {/* Checkbox dropdown for desktop */}
            <div className="relative hidden md:flex items-center">
              <button
                onClick={handleToggleSelectAllCheckbox}
                className="p-1.5 rounded hover:bg-neutral-100 dark:hover:bg-[#2e2e2e] text-neutral-600 dark:text-neutral-300"
                aria-label="Select all"
              >
                {allSelected ? (
                  <CheckSquare className="w-4 h-4 text-[#0494f4]" />
                ) : someSelected ? (
                  <MinusSquare className="w-4 h-4 text-[#0494f4]" />
                ) : (
                  <Square className="w-4 h-4 text-neutral-400" />
                )}
              </button>

              <button
                onClick={() => setIsSelectMenuOpen(!isSelectMenuOpen)}
                className="p-1 -ml-1 rounded hover:bg-neutral-100 dark:hover:bg-[#2e2e2e] text-neutral-500"
                aria-label="Selection options"
              >
                <svg className="w-3 h-3 fill-current" viewBox="0 0 24 24">
                  <path d="M7 10l5 5 5-5z" />
                </svg>
              </button>

              {/* Select Options Popover */}
              {isSelectMenuOpen && (
                <div className="absolute left-0 top-8 w-36 bg-white dark:bg-[#262626] border border-neutral-200 dark:border-[#383838] rounded-xl shadow-lg py-1 z-40 text-xs font-medium">
                  <button
                    onClick={() => handleSelectAllDropdown('all')}
                    className="w-full text-left px-3 py-1.5 hover:bg-neutral-100 dark:hover:bg-[#333333] text-neutral-800 dark:text-neutral-200"
                  >
                    All
                  </button>
                  <button
                    onClick={() => handleSelectAllDropdown('none')}
                    className="w-full text-left px-3 py-1.5 hover:bg-neutral-100 dark:hover:bg-[#333333] text-neutral-800 dark:text-neutral-200"
                  >
                    None
                  </button>
                  <button
                    onClick={() => handleSelectAllDropdown('read')}
                    className="w-full text-left px-3 py-1.5 hover:bg-neutral-100 dark:hover:bg-[#333333] text-neutral-800 dark:text-neutral-200"
                  >
                    Read
                  </button>
                  <button
                    onClick={() => handleSelectAllDropdown('unread')}
                    className="w-full text-left px-3 py-1.5 hover:bg-neutral-100 dark:hover:bg-[#333333] text-neutral-800 dark:text-neutral-200"
                  >
                    Unread
                  </button>
                  <button
                    onClick={() => handleSelectAllDropdown('starred')}
                    className="w-full text-left px-3 py-1.5 hover:bg-neutral-100 dark:hover:bg-[#333333] text-neutral-800 dark:text-neutral-200"
                  >
                    Starred
                  </button>
                </div>
              )}
            </div>

            {/* Folder / Label Title on Mobile */}
            <div className="md:hidden flex items-center gap-1.5">
              <span className="text-xs font-bold text-neutral-700 dark:text-neutral-300 capitalize tracking-tight">
                {selectedLabel ? `Label: ${selectedLabel}` : currentFolder}
              </span>
              <span className="text-[11px] text-neutral-400 font-mono tabular-nums">
                ({filteredEmails.length})
              </span>
            </div>

            {/* Refresh Button */}
            <button
              onClick={refreshEmails}
              className={`p-1.5 rounded-full hover:bg-neutral-100 dark:hover:bg-[#2e2e2e] text-neutral-600 dark:text-neutral-300 transition-transform ${
                isRefreshing ? 'animate-spin text-[#0494f4]' : ''
              }`}
              title="Refresh"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>

          {/* Right Toolbar Controls: Pagination & Split View toggle */}
          <div className="flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
            <span className="tabular-nums font-medium">
              {filteredEmails.length > 0 ? `1–${filteredEmails.length} of ${filteredEmails.length}` : '0 of 0'}
            </span>

            {/* Reading Pane Split Mode Switcher (Desktop only) */}
            <div className="hidden lg:flex items-center gap-0.5 border-l border-neutral-200 dark:border-[#333333] pl-2 ml-1">
              <button
                onClick={() => setSplitView(splitView === 'vertical' ? 'none' : 'vertical')}
                className={`p-1.5 rounded transition-colors ${
                  splitView === 'vertical'
                    ? 'bg-[#0494f4]/15 text-[#0494f4]'
                    : 'hover:bg-neutral-100 dark:hover:bg-[#2e2e2e] text-neutral-500'
                }`}
                title="Toggle vertical reading pane"
              >
                <Columns className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          CATEGORY TABS (Primary, Social, Promotions, Updates, Forums)
      ========================================================================= */}
      {currentFolder === 'inbox' && !selectedLabel && !searchQuery.trim() && (
        <div className="flex items-center border-b border-neutral-200 dark:border-[#333333] px-2 sm:px-4 bg-white dark:bg-[#212121] overflow-x-auto no-scrollbar shrink-0 select-none">
          {categoryTabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = currentCategory === tab.category;
            return (
              <button
                key={tab.category}
                onClick={() => setCurrentCategory(tab.category)}
                className={`relative flex items-center gap-2 sm:gap-2.5 py-3 px-3.5 sm:px-5 text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap min-h-[44px] ${
                  isActive
                    ? 'text-[#0494f4]'
                    : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-[#282828]'
                }`}
              >
                <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-[#0494f4]' : 'text-neutral-500'}`} />
                <span>{tab.label}</span>
                {tab.count > 0 && (
                  <span
                    className={`text-[10px] tabular-nums font-bold px-1.5 py-0.2 rounded-full ${
                      isActive
                        ? 'bg-[#0494f4] text-white'
                        : 'bg-neutral-100 dark:bg-[#333333] text-neutral-600 dark:text-neutral-300'
                    }`}
                  >
                    {tab.count}
                  </span>
                )}
                {/* Active Indicator Underline */}
                {isActive && (
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#0494f4] rounded-t-full" />
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* =========================================================================
          EMAIL LIST ITEMS (Dual-Engine: Mobile-Native Card + Desktop Table Row)
      ========================================================================= */}
      <div className="flex-1 overflow-y-auto no-scrollbar divide-y divide-neutral-100 dark:divide-[#2e2e2e]">
        {filteredEmails.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
            <div className="w-16 h-16 rounded-2xl bg-neutral-100 dark:bg-[#2a2a2a] flex items-center justify-center text-neutral-400 mb-4">
              <Inbox className="w-8 h-8 text-[#0494f4]/60" />
            </div>
            <h3 className="text-base font-semibold text-neutral-800 dark:text-neutral-200 mb-1">
              Nothing in {currentFolder}
            </h3>
            <p className="text-xs text-neutral-500 dark:text-neutral-400 max-w-sm">
              Any conversations moving to or arriving in this view will appear here instantly.
            </p>
          </div>
        ) : (
          filteredEmails.map((email) => {
            const isSelected = selectedIds.includes(email.id);
            const isCurrentlyActive = selectedEmailId === email.id;

            return (
              <div
                key={email.id}
                onClick={() => handleEmailClick(email)}
                className={`group relative transition-colors cursor-pointer select-none ${
                  isCurrentlyActive
                    ? 'bg-[#0494f4]/10 dark:bg-[#0494f4]/15'
                    : isSelected
                    ? 'bg-[#0494f4]/5 dark:bg-[#0494f4]/10'
                    : email.isRead
                    ? 'bg-white dark:bg-[#212121] hover:bg-neutral-50 dark:hover:bg-[#282828]'
                    : 'bg-neutral-50/70 dark:bg-[#262626] hover:bg-neutral-100/70 dark:hover:bg-[#2d2d2d]'
                }`}
              >
                {/* -------------------------------------------------------------
                    A. MOBILE LAYOUT (Authentic Native Gmail Mobile Row Layout)
                -------------------------------------------------------------- */}
                <div className="md:hidden flex items-start gap-3 p-3.5 min-h-[72px]">
                  {/* Avatar / Selection Checkmark */}
                  <div
                    className="shrink-0 mt-0.5"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleSelectId(email.id);
                    }}
                  >
                    {isSelected ? (
                      <div className="w-10 h-10 rounded-full bg-[#0494f4] text-white flex items-center justify-center shadow-sm">
                        <Check className="w-5 h-5 stroke-[2.5]" />
                      </div>
                    ) : (
                      <div className="w-10 h-10 rounded-full bg-neutral-200 dark:bg-[#333333] text-neutral-700 dark:text-neutral-200 font-bold text-xs flex items-center justify-center">
                        {email.senderName.substring(0, 2).toUpperCase()}
                      </div>
                    )}
                  </div>

                  {/* Stacked Content Column */}
                  <div className="flex-1 min-w-0">
                    {/* Top Row: Sender & Date */}
                    <div className="flex items-center justify-between gap-2 mb-0.5">
                      <span
                        className={`text-sm truncate ${
                          email.isRead
                            ? 'text-neutral-700 dark:text-neutral-300 font-normal'
                            : 'text-neutral-900 dark:text-white font-bold'
                        }`}
                      >
                        {email.senderName}
                      </span>
                      <span
                        className={`text-[11px] tabular-nums shrink-0 font-medium ${
                          email.isRead
                            ? 'text-neutral-400 dark:text-neutral-500'
                            : 'text-[#0494f4] font-bold'
                        }`}
                      >
                        {email.dateFormatted}
                      </span>
                    </div>

                    {/* Middle Row: Subject */}
                    <p
                      className={`text-xs truncate ${
                        email.isRead
                          ? 'text-neutral-800 dark:text-neutral-200 font-medium'
                          : 'text-neutral-900 dark:text-white font-bold'
                      }`}
                    >
                      {email.subject}
                    </p>

                    {/* Bottom Row: Snippet & Star */}
                    <div className="flex items-center justify-between gap-2 mt-0.5">
                      <p className="text-xs text-neutral-500 dark:text-neutral-400 truncate flex-1">
                        {email.snippet}
                      </p>

                      {/* Mobile Star Button (44px touch target) */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleStar(email.id);
                        }}
                        className="p-1 -mr-1 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200 shrink-0"
                        aria-label="Star"
                      >
                        <Star
                          className={`w-4 h-4 ${
                            email.isStarred
                              ? 'fill-[#0494f4] text-[#0494f4]'
                              : 'text-neutral-400'
                          }`}
                        />
                      </button>
                    </div>

                    {/* Optional Attachments Pill on Mobile */}
                    {email.attachments && email.attachments.length > 0 && (
                      <div className="mt-1.5 flex items-center gap-1.5">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-neutral-200 dark:border-[#383838] bg-white dark:bg-[#1e1e1e] text-[10px] text-neutral-600 dark:text-neutral-300 font-medium">
                          <Paperclip className="w-2.5 h-2.5 text-[#0494f4]" />
                          <span className="truncate max-w-[140px]">
                            {email.attachments[0].name}
                          </span>
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* -------------------------------------------------------------
                    B. DESKTOP LAYOUT (Classic 1-Row Gmail Desktop Table Item)
                -------------------------------------------------------------- */}
                <div className="hidden md:flex items-center gap-3 px-4 py-3 min-h-[48px]">
                  {/* Checkbox */}
                  <div
                    className="shrink-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleSelectId(email.id);
                    }}
                  >
                    <button
                      className="p-1 rounded hover:bg-neutral-200 dark:hover:bg-[#383838] text-neutral-400 transition-colors"
                      aria-label="Select message"
                    >
                      {isSelected ? (
                        <CheckSquare className="w-4 h-4 text-[#0494f4]" />
                      ) : (
                        <Square className="w-4 h-4 text-neutral-400 group-hover:text-neutral-600 dark:group-hover:text-neutral-300" />
                      )}
                    </button>
                  </div>

                  {/* Star Button */}
                  <div
                    className="shrink-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleStar(email.id);
                    }}
                  >
                    <button
                      className="p-1 rounded hover:bg-neutral-200 dark:hover:bg-[#383838] transition-colors"
                      aria-label="Star message"
                    >
                      <Star
                        className={`w-4 h-4 ${
                          email.isStarred
                            ? 'fill-[#0494f4] text-[#0494f4]'
                            : 'text-neutral-400 group-hover:text-neutral-600 dark:group-hover:text-neutral-300'
                        }`}
                      />
                    </button>
                  </div>

                  {/* Sender Avatar */}
                  <div className="shrink-0 w-8 h-8 rounded-full bg-neutral-200 dark:bg-[#333333] text-neutral-700 dark:text-neutral-200 font-bold text-xs flex items-center justify-center">
                    {email.senderName.substring(0, 2).toUpperCase()}
                  </div>

                  {/* Sender Name */}
                  <div className="w-44 shrink-0 truncate">
                    <span
                      className={`text-sm truncate ${
                        email.isRead
                          ? 'text-neutral-700 dark:text-neutral-300 font-normal'
                          : 'text-neutral-900 dark:text-white font-bold'
                      }`}
                    >
                      {email.senderName}
                    </span>
                  </div>

                  {/* Subject and Snippet */}
                  <div className="flex-1 min-w-0 flex items-center gap-2 overflow-hidden">
                    <span
                      className={`text-sm truncate ${
                        email.isRead
                          ? 'text-neutral-800 dark:text-neutral-200 font-medium'
                          : 'text-neutral-900 dark:text-white font-bold'
                      }`}
                    >
                      {email.subject}
                    </span>
                    <span className="text-xs text-neutral-400 dark:text-neutral-500">-</span>
                    <span className="text-xs text-neutral-500 dark:text-neutral-400 truncate">
                      {email.snippet}
                    </span>

                    {/* Attachment Pill */}
                    {email.attachments && email.attachments.length > 0 && (
                      <div className="hidden lg:flex items-center gap-1 shrink-0 px-2 py-0.5 rounded-full border border-neutral-200 dark:border-[#383838] bg-neutral-50 dark:bg-[#282828] text-[11px] text-neutral-600 dark:text-neutral-300">
                        <Paperclip className="w-3 h-3 text-[#0494f4]" />
                        <span className="truncate max-w-[120px]">{email.attachments[0].name}</span>
                      </div>
                    )}

                    {/* Labels chips */}
                    {email.labels && email.labels.length > 0 && (
                      <div className="hidden xl:flex items-center gap-1 shrink-0">
                        {email.labels.slice(0, 2).map((lbl) => (
                          <span
                            key={lbl}
                            className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#0494f4]/15 text-[#0494f4]"
                          >
                            {lbl}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Date or Hover Actions on Desktop */}
                  <div className="shrink-0 flex items-center justify-end min-w-[70px]">
                    <span
                      className={`text-xs tabular-nums font-medium ${
                        email.isRead
                          ? 'text-neutral-500 dark:text-neutral-400'
                          : 'text-[#0494f4] font-bold'
                      } group-hover:hidden`}
                    >
                      {email.dateFormatted}
                    </span>

                    {/* Hover State Action Icons */}
                    <div
                      className="hidden group-hover:flex items-center gap-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        onClick={() => archiveEmails([email.id])}
                        className="p-1 rounded-full hover:bg-neutral-200 dark:hover:bg-[#383838] text-neutral-600 dark:text-neutral-300"
                        title="Archive"
                      >
                        <Archive className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => deleteEmails([email.id])}
                        className="p-1 rounded-full hover:bg-neutral-200 dark:hover:bg-[#383838] text-neutral-600 dark:text-neutral-300"
                        title="Delete"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => markAsRead([email.id], !email.isRead)}
                        className="p-1 rounded-full hover:bg-neutral-200 dark:hover:bg-[#383838] text-neutral-600 dark:text-neutral-300"
                        title={email.isRead ? 'Mark as unread' : 'Mark as read'}
                      >
                        {email.isRead ? <Mail className="w-3.5 h-3.5" /> : <MailOpen className="w-3.5 h-3.5" />}
                      </button>
                      <button
                        onClick={() => snoozeEmails([email.id])}
                        className="p-1 rounded-full hover:bg-neutral-200 dark:hover:bg-[#383838] text-neutral-600 dark:text-neutral-300"
                        title="Snooze"
                      >
                        <Clock className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
