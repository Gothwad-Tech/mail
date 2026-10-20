import React, { useState } from 'react';
import {
  CheckSquare,
  Square,
  MinusSquare,
  RefreshCw,
  Trash2,
  Mail,
  MailOpen,
  Star,
  Paperclip,
  Inbox,
  Columns,
  X,
  AlertTriangle,
} from 'lucide-react';
import { useMail, toComposeData, toEmailMessage } from '../context/MailContext';
import { mailApi, ApiError } from '../services/mailApi';
import { EmailMessage } from '../types/email';

const FOLDER_TITLES: Record<string, string> = {
  inbox: 'Inbox',
  starred: 'Starred',
  sent: 'Sent',
  drafts: 'Drafts',
  trash: 'Trash',
};

function initialOf(name: string): string {
  const ch = name.trim().charAt(0);
  return ch ? ch.toUpperCase() : '?';
}

export const EmailList: React.FC = () => {
  const {
    filteredEmails,
    isLoadingEmails,
    emailsError,
    isRefreshing,
    hasMore,
    loadMore,
    prefetchEmail,
    currentFolder,
    selectedIds,
    toggleSelectId,
    selectAllIds,
    clearSelection,
    toggleStar,
    markAsRead,
    deleteEmails,
    selectedEmailId,
    setSelectedEmailId,
    refreshEmails,
    splitView,
    setSplitView,
    openCompose,
    showToast,
  } = useMail();

  const [isSelectMenuOpen, setIsSelectMenuOpen] = useState(false);

  const allFilteredIds = filteredEmails.map((e) => e.id);
  const allSelected = allFilteredIds.length > 0 && allFilteredIds.every((id) => selectedIds.includes(id));
  const someSelected = selectedIds.length > 0 && !allSelected;
  const anySelected = selectedIds.length > 0;

  const handleSelectDropdown = (type: 'all' | 'none' | 'read' | 'unread' | 'starred' | 'unstarred') => {
    setIsSelectMenuOpen(false);
    if (type === 'all') selectAllIds(allFilteredIds);
    else if (type === 'none') clearSelection();
    else if (type === 'read') selectAllIds(filteredEmails.filter((e) => e.isRead).map((e) => e.id));
    else if (type === 'unread') selectAllIds(filteredEmails.filter((e) => !e.isRead).map((e) => e.id));
    else if (type === 'starred') selectAllIds(filteredEmails.filter((e) => e.isStarred).map((e) => e.id));
    else if (type === 'unstarred') selectAllIds(filteredEmails.filter((e) => !e.isStarred).map((e) => e.id));
  };

  const handleToggleSelectAllCheckbox = () => {
    if (allSelected || someSelected) clearSelection();
    else selectAllIds(allFilteredIds);
  };

  const handleRowClick = async (email: EmailMessage) => {
    // Drafts open in the compose window, not the reader. The list does not
    // include the body, so fetch the full draft first.
    if (currentFolder === 'drafts') {
      try {
        const { message } = await mailApi.getMessage(email.id);
        openCompose(toComposeData(toEmailMessage(message)));
      } catch (err) {
        showToast(err instanceof ApiError ? err.message : 'Could not open the draft.');
      }
      return;
    }
    setSelectedEmailId(email.id);
  };

  const trashLabel = currentFolder === 'trash' ? 'Delete forever' : 'Move to Trash';

  return (
    <div className="flex-1 flex flex-col h-full bg-white dark:bg-[#212121] overflow-hidden select-none">
      {/* ----- Toolbar: selection bar when something is selected, otherwise the normal bar ----- */}
      {anySelected ? (
        <div className="h-12 border-b border-[#0494f4]/30 bg-[#0494f4]/10 dark:bg-[#0494f4]/15 px-3 sm:px-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <button
              onClick={clearSelection}
              className="p-1.5 rounded-full hover:bg-black/10 dark:hover:bg-white/10 text-neutral-700 dark:text-neutral-200"
              aria-label="Clear selection"
            >
              <X className="w-5 h-5" />
            </button>
            <span className="text-sm font-bold text-[#0494f4] tabular-nums">{selectedIds.length} selected</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => markAsRead(selectedIds, true)}
              className="p-2 rounded-full hover:bg-black/10 dark:hover:bg-white/10 text-neutral-700 dark:text-neutral-200"
              title="Mark as read"
              aria-label="Mark as read"
            >
              <MailOpen className="w-4 h-4" />
            </button>
            <button
              onClick={() => markAsRead(selectedIds, false)}
              className="p-2 rounded-full hover:bg-black/10 dark:hover:bg-white/10 text-neutral-700 dark:text-neutral-200"
              title="Mark as unread"
              aria-label="Mark as unread"
            >
              <Mail className="w-4 h-4" />
            </button>
            <button
              onClick={() => deleteEmails(selectedIds)}
              className="p-2 rounded-full hover:bg-black/10 dark:hover:bg-white/10 text-neutral-700 dark:text-neutral-200"
              title={trashLabel}
              aria-label={trashLabel}
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      ) : (
        <div className="h-12 border-b border-neutral-200 dark:border-[#333333] px-3 sm:px-4 flex items-center justify-between shrink-0 bg-white dark:bg-[#212121]">
          <div className="flex items-center gap-2 relative">
            {/* Select checkbox + dropdown */}
            <button
              onClick={handleToggleSelectAllCheckbox}
              className="p-1.5 rounded hover:bg-neutral-100 dark:hover:bg-[#2e2e2e] text-neutral-500"
              aria-label="Select all"
              title="Select all"
              disabled={filteredEmails.length === 0}
            >
              {allSelected ? (
                <CheckSquare className="w-4 h-4 text-[#0494f4]" />
              ) : someSelected ? (
                <MinusSquare className="w-4 h-4 text-[#0494f4]" />
              ) : (
                <Square className="w-4 h-4" />
              )}
            </button>
            <button
              onClick={() => setIsSelectMenuOpen(!isSelectMenuOpen)}
              className="px-1 text-neutral-500 text-xs"
              aria-label="Selection options"
            >
              ▾
            </button>
            {isSelectMenuOpen && (
              <div className="absolute top-8 left-0 w-40 bg-white dark:bg-[#2a2a2a] border border-neutral-200 dark:border-[#383838] rounded-xl shadow-xl py-1 z-30 text-xs">
                {(
                  [
                    ['all', 'All'],
                    ['none', 'None'],
                    ['read', 'Read'],
                    ['unread', 'Unread'],
                    ['starred', 'Starred'],
                    ['unstarred', 'Unstarred'],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => handleSelectDropdown(key)}
                    className="w-full text-left px-3 py-1.5 hover:bg-neutral-100 dark:hover:bg-[#333333]"
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}

            <span className="text-sm font-bold text-neutral-800 dark:text-neutral-200 capitalize">
              {FOLDER_TITLES[currentFolder] ?? currentFolder}
            </span>
            <span className="text-[11px] text-neutral-400 font-mono tabular-nums">({filteredEmails.length})</span>

            <button
              onClick={refreshEmails}
              className={`p-1.5 rounded-full hover:bg-neutral-100 dark:hover:bg-[#2e2e2e] text-neutral-600 dark:text-neutral-300 ${
                isLoadingEmails ? 'animate-spin text-[#0494f4]' : ''
              }`}
              title="Refresh"
              aria-label="Refresh"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>

          <div className="hidden lg:flex items-center gap-0.5">
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
      )}

      {/* ----- List ----- */}
      <div className="flex-1 overflow-y-auto overscroll-contain no-scrollbar divide-y divide-neutral-100 dark:divide-[#2e2e2e]">
        {/* Thin bar while a cached list revalidates: no layout jump, no spinner. */}
        <div
          className={`h-0.5 shrink-0 ${isRefreshing ? 'bg-[#0494f4]/70 animate-pulse' : 'bg-transparent'}`}
          aria-hidden="true"
        />
        {emailsError ? (
          <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
            <AlertTriangle className="w-8 h-8 text-amber-500 mb-3" />
            <h3 className="text-base font-semibold text-neutral-800 dark:text-neutral-200 mb-1">Couldn't load {currentFolder}</h3>
            <p className="text-xs text-neutral-500 dark:text-neutral-400 max-w-sm mb-4">{emailsError}</p>
            <button
              onClick={refreshEmails}
              className="px-4 py-2 rounded-full bg-[#0494f4] hover:bg-[#0382d6] text-white text-xs font-semibold"
            >
              Try again
            </button>
          </div>
        ) : isLoadingEmails && filteredEmails.length === 0 ? (
          // Skeleton rows: the layout appears immediately, which feels much
          // faster than a spinner on a slow phone connection.
          <div aria-busy="true" aria-label="Loading messages">
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="flex animate-pulse items-center gap-3 px-3 py-3 sm:px-4">
                <div className="h-8 w-8 shrink-0 rounded-full bg-neutral-200 dark:bg-[#333333]" />
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex items-center gap-3">
                    <div className="h-3 w-1/3 rounded bg-neutral-200 dark:bg-[#333333]" />
                    <div className="ml-auto h-3 w-10 rounded bg-neutral-100 dark:bg-[#2e2e2e]" />
                  </div>
                  <div className="h-3 w-4/5 rounded bg-neutral-100 dark:bg-[#2e2e2e]" />
                </div>
              </div>
            ))}
          </div>
        ) : filteredEmails.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
            <div className="w-16 h-16 rounded-2xl bg-neutral-100 dark:bg-[#2a2a2a] flex items-center justify-center text-neutral-400 mb-4">
              <Inbox className="w-8 h-8 text-[#0494f4]/60" />
            </div>
            <h3 className="text-base font-semibold text-neutral-800 dark:text-neutral-200 mb-1">
              Nothing in {FOLDER_TITLES[currentFolder] ?? currentFolder} yet
            </h3>
            <p className="text-xs text-neutral-500 dark:text-neutral-400 max-w-sm">
              {currentFolder === 'inbox'
                ? 'Mail sent to your Gothwad address will show up here.'
                : 'Nothing to show here yet.'}
            </p>
          </div>
        ) : (
          <>
            {filteredEmails.map((email) => {
              const isSelected = selectedIds.includes(email.id);
              const isActive = selectedEmailId === email.id;
              const showTo = currentFolder === 'sent' || currentFolder === 'drafts';
              const who = showTo ? `To: ${email.toRecipients.join(', ') || '(no recipient)'}` : email.senderName;

              return (
                <div
                  key={email.id}
                  onClick={() => handleRowClick(email)}
                  // Warm the body before the tap lands: hovering (desktop) or
                  // touching (mobile) means the user is about to open it.
                  onMouseEnter={() => prefetchEmail(email.id)}
                  onFocus={() => prefetchEmail(email.id)}
                  onTouchStart={() => prefetchEmail(email.id)}
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleRowClick(email);
                  }}
                  className={`group flex items-center gap-3 px-3 sm:px-4 py-2.5 min-h-[60px] cursor-pointer transition-colors active:bg-neutral-100 dark:active:bg-[#2e2e2e] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#0494f4] ${
                    isActive
                      ? 'bg-[#0494f4]/10 dark:bg-[#0494f4]/15'
                      : isSelected
                      ? 'bg-[#0494f4]/5 dark:bg-[#0494f4]/10'
                      : email.isRead
                      ? 'bg-white dark:bg-[#212121] hover:bg-neutral-50 dark:hover:bg-[#282828]'
                      : 'bg-neutral-50/70 dark:bg-[#262626] hover:bg-neutral-100/70 dark:hover:bg-[#2d2d2d]'
                  }`}
                >
                  {/* Avatar doubles as the selection checkbox */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleSelectId(email.id);
                    }}
                    className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
                      isSelected
                        ? 'bg-[#0494f4] text-white'
                        : 'bg-neutral-200 dark:bg-[#383838] text-neutral-700 dark:text-neutral-200'
                    }`}
                    aria-label="Select message"
                  >
                    {isSelected ? <CheckSquare className="w-4 h-4" /> : initialOf(email.senderName)}
                  </button>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2 min-w-0">
                      {!email.isRead && (
                        <span
                          className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#0494f4]"
                          aria-label="Unread"
                        />
                      )}
                      <span
                        className={`truncate text-sm ${
                          email.isRead ? 'text-neutral-700 dark:text-neutral-300' : 'font-bold text-neutral-900 dark:text-white'
                        }`}
                      >
                        {who}
                      </span>
                      <span className="ml-auto shrink-0 text-[11px] text-neutral-500 tabular-nums">
                        {email.dateFormatted}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className={`truncate text-sm ${
                          email.isRead ? 'text-neutral-600 dark:text-neutral-400' : 'font-semibold text-neutral-800 dark:text-neutral-200'
                        }`}
                      >
                        {email.subject || '(no subject)'}
                      </span>
                      <span className="hidden sm:inline truncate text-xs text-neutral-400">
                        {email.snippet ? `— ${email.snippet}` : ''}
                      </span>
                      {email.attachments.length > 0 && (
                        <Paperclip className="w-3.5 h-3.5 text-neutral-400 shrink-0" aria-label="Has attachments" />
                      )}
                    </div>
                  </div>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleStar(email.id);
                    }}
                    className="shrink-0 p-1 rounded-full hover:bg-neutral-200 dark:hover:bg-[#383838]"
                    aria-label={email.isStarred ? 'Unstar message' : 'Star message'}
                  >
                    <Star
                      className={`w-4 h-4 ${email.isStarred ? 'fill-amber-400 text-amber-400' : 'text-neutral-400'}`}
                    />
                  </button>
                </div>
              );
            })}

            {hasMore && (
              <div className="flex justify-center py-4">
                <button
                  onClick={loadMore}
                  disabled={isLoadingEmails}
                  className="px-4 py-2 rounded-full border border-neutral-200 dark:border-[#383838] text-xs font-semibold text-neutral-700 dark:text-neutral-200 hover:bg-neutral-50 dark:hover:bg-[#282828] disabled:opacity-50"
                >
                  {isLoadingEmails ? 'Loading…' : 'Load more'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
