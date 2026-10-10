import React from 'react';
import { Inbox, Star, Send, FileText, Trash2, PenTool } from 'lucide-react';
import { useMail } from '../context/MailContext';
import { EmailFolder } from '../types/email';

interface SidebarProps {
  isCollapsed: boolean;
}

// Only folders the database supports. Archive, Snoozed, Spam, Labels etc. were
// removed because the mail_messages table has no column for them.
const NAV_ITEMS: Array<{
  folder: EmailFolder;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { folder: 'inbox', label: 'Inbox', icon: Inbox },
  { folder: 'starred', label: 'Starred', icon: Star },
  { folder: 'sent', label: 'Sent', icon: Send },
  { folder: 'drafts', label: 'Drafts', icon: FileText },
  { folder: 'trash', label: 'Trash', icon: Trash2 },
];

export const Sidebar: React.FC<SidebarProps> = ({ isCollapsed }) => {
  const { currentFolder, setCurrentFolder, openCompose, currentUser, sendRemainingToday, dailySendLimit, accountUrl } =
    useMail();

  return (
    <aside
      className={`hidden md:flex flex-col h-[calc(100vh-4rem)] border-r border-neutral-200 dark:border-[#333333] bg-white dark:bg-[#212121] transition-all duration-200 shrink-0 select-none ${
        isCollapsed ? 'w-18 px-2' : 'w-64 px-3'
      }`}
    >
      {/* Compose Button */}
      <div className="py-4">
        <button
          onClick={() => openCompose()}
          className={`flex items-center gap-3 bg-[#0494f4] hover:bg-[#0382d6] text-white shadow-md shadow-[#0494f4]/20 transition-all font-semibold rounded-2xl ${
            isCollapsed
              ? 'w-12 h-12 justify-center mx-auto'
              : 'w-full py-3.5 px-5 text-sm tracking-wide'
          }`}
          title="Compose new message"
        >
          <PenTool className="w-5 h-5 shrink-0" />
          {!isCollapsed && <span>Compose</span>}
        </button>
      </div>

      {/* Navigation */}
      <div className="flex-1 overflow-y-auto no-scrollbar space-y-1">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = currentFolder === item.folder;

          return (
            <button
              key={item.folder}
              onClick={() => setCurrentFolder(item.folder)}
              className={`w-full flex items-center rounded-full transition-colors ${
                isCollapsed ? 'h-11 justify-center' : 'h-10 px-4'
              } ${
                isActive
                  ? 'bg-[#0494f4]/15 text-[#0494f4] font-bold dark:bg-[#0494f4]/20'
                  : 'text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-[#2a2a2a]'
              }`}
              title={isCollapsed ? item.label : undefined}
            >
              <div className="flex items-center gap-3.5 min-w-0">
                <Icon
                  className={`w-4 h-4 shrink-0 ${
                    isActive ? 'text-[#0494f4]' : 'text-neutral-500 dark:text-neutral-400'
                  }`}
                />
                {!isCollapsed && <span className="text-sm truncate font-medium">{item.label}</span>}
              </div>
            </button>
          );
        })}
      </div>

      {/* Bottom: the signed-in address (derived from the Accounts username) */}
      {!isCollapsed && (
        <div className="py-3 border-t border-neutral-200 dark:border-[#333333] space-y-2">
          <div className="p-2.5 rounded-xl bg-neutral-50 dark:bg-[#282828]">
            <p className="text-[11px] text-neutral-500 dark:text-neutral-400">Signed in as</p>
            <p className="text-xs font-semibold text-neutral-800 dark:text-neutral-200 truncate" title={currentUser.email}>
              {currentUser.email}
            </p>
            <a
              href={accountUrl}
              target="_blank"
              rel="noreferrer"
              className="text-[11px] text-[#0494f4] hover:underline"
            >
              Manage account
            </a>
          </div>
          {sendRemainingToday !== null && dailySendLimit !== null && (
            <p className="px-1 text-[11px] text-neutral-500 dark:text-neutral-400">
              {sendRemainingToday} of {dailySendLimit} sends left today
            </p>
          )}
        </div>
      )}
    </aside>
  );
};
