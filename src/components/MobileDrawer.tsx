import React from 'react';
import { X, Inbox, Star, Send, FileText, Trash2, Moon, Sun, Settings, ExternalLink } from 'lucide-react';
import { useMail } from '../context/MailContext';
import { EmailFolder } from '../types/email';

const FOLDERS: Array<{ folder: EmailFolder; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { folder: 'inbox', label: 'Inbox', icon: Inbox },
  { folder: 'starred', label: 'Starred', icon: Star },
  { folder: 'sent', label: 'Sent', icon: Send },
  { folder: 'drafts', label: 'Drafts', icon: FileText },
  { folder: 'trash', label: 'Trash', icon: Trash2 },
];

export const MobileDrawer: React.FC = () => {
  const {
    isMobileNavOpen,
    setIsMobileNavOpen,
    currentFolder,
    setCurrentFolder,
    theme,
    toggleTheme,
    setIsSettingsModalOpen,
    currentUser,
    accountUrl,
    unreadInboxCount,
  } = useMail();

  if (!isMobileNavOpen) return null;

  const handleSelectFolder = (folder: EmailFolder) => {
    setCurrentFolder(folder);
    setIsMobileNavOpen(false);
  };

  return (
    <div className="fixed inset-0 z-50 md:hidden flex select-none animate-in fade-in duration-150">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-xs transition-opacity"
        onClick={() => setIsMobileNavOpen(false)}
      />

      {/* Drawer Surface */}
      <div className="relative w-80 max-w-[85vw] h-full bg-white dark:bg-[#212121] flex flex-col z-10 shadow-2xl border-r border-neutral-200 dark:border-[#383838]">
        {/* Drawer Brand Header */}
        <div className="p-4 border-b border-neutral-200 dark:border-[#333333] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-[#0494f4] flex items-center justify-center text-white shadow-sm shadow-[#0494f4]/25">
              <svg
                className="w-4 h-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.3"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect width="20" height="16" x="2" y="4" rx="3" />
                <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
              </svg>
            </div>
            <span className="text-base font-bold text-neutral-900 dark:text-white">
              Gothwad<span className="text-[#0494f4] font-semibold ml-1">Mail</span>
            </span>
          </div>
          <button
            onClick={() => setIsMobileNavOpen(false)}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-neutral-100 dark:hover:bg-[#2e2e2e] text-neutral-500"
            aria-label="Close menu"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* User Card (from the Accounts session) */}
        <div className="px-4 py-3 bg-neutral-50 dark:bg-[#262626] border-b border-neutral-200 dark:border-[#333333] flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-[#0494f4] text-xs font-bold text-white shadow-xs">
            {currentUser.avatarUrl ? (
              <img
                src={currentUser.avatarUrl}
                alt=""
                className="h-full w-full object-cover"
                referrerPolicy="no-referrer"
              />
            ) : (
              currentUser.avatarText
            )}
          </div>
          <div className="min-w-0">
            <p className="text-xs font-bold text-neutral-900 dark:text-white truncate">
              {currentUser.name || currentUser.username}
            </p>
            <p className="text-[11px] text-neutral-500 dark:text-neutral-400 truncate">{currentUser.email}</p>
          </div>
        </div>

        {/* Folders */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {FOLDERS.map((item) => {
            const Icon = item.icon;
            const isActive = currentFolder === item.folder;
            return (
              <button
                key={item.folder}
                onClick={() => handleSelectFolder(item.folder)}
                className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-full text-xs font-medium transition-colors ${
                  isActive
                    ? 'bg-[#0494f4]/15 text-[#0494f4] font-bold'
                    : 'text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-[#2b2b2b]'
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? 'text-[#0494f4]' : 'text-neutral-500'}`} />
                <span>{item.label}</span>
                {item.folder === 'inbox' && unreadInboxCount > 0 && (
                  <span className="ml-auto rounded-full bg-[#0494f4] px-1.5 text-[10px] font-bold leading-4 text-white">
                    {unreadInboxCount > 99 ? '99+' : unreadInboxCount}
                  </span>
                )}
              </button>
            );
          })}
          <a
            href={accountUrl}
            target="_blank"
            rel="noreferrer"
            className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-full text-xs font-medium text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-[#2b2b2b]"
          >
            <ExternalLink className="w-4 h-4 text-neutral-500" />
            <span>Manage Gothwad Account</span>
          </a>
        </div>

        {/* Bottom Drawer Actions */}
        <div className="p-3 border-t border-neutral-200 dark:border-[#333333] flex items-center gap-2">
          <button
            onClick={toggleTheme}
            className="flex-1 flex items-center justify-center gap-2 py-2 rounded-xl border border-neutral-200 dark:border-[#383838] text-xs font-medium text-neutral-700 dark:text-neutral-300"
          >
            {theme === 'dark' ? (
              <>
                <Sun className="w-4 h-4 text-[#0494f4]" />
                <span>Light (#ffffff)</span>
              </>
            ) : (
              <>
                <Moon className="w-4 h-4 text-[#0494f4]" />
                <span>Dark (#212121)</span>
              </>
            )}
          </button>
          <button
            onClick={() => {
              setIsMobileNavOpen(false);
              setIsSettingsModalOpen(true);
            }}
            className="p-2.5 rounded-xl border border-neutral-200 dark:border-[#383838] text-neutral-700 dark:text-neutral-300"
            aria-label="Settings"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
