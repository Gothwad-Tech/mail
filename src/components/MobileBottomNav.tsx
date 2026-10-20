import React from 'react';
import { Mail, Star, Send, PenTool, FileText, Trash2 } from 'lucide-react';
import { useMail } from '../context/MailContext';
import { EmailFolder } from '../types/email';

const TABS: Array<{ folder: EmailFolder; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { folder: 'inbox', label: 'Inbox', icon: Mail },
  { folder: 'starred', label: 'Starred', icon: Star },
  { folder: 'sent', label: 'Sent', icon: Send },
  { folder: 'drafts', label: 'Drafts', icon: FileText },
  { folder: 'trash', label: 'Trash', icon: Trash2 },
];

export const MobileBottomNav: React.FC = () => {
  const { currentFolder, setCurrentFolder, openCompose, selectedEmailId, unreadInboxCount } = useMail();

  // While reading, the reading pane owns the screen.
  if (selectedEmailId) return null;

  return (
    <>
      {/* Round compose button, kept above the bar and off the thumb-safe area. */}
      <div className="fixed right-4 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-40 md:hidden">
        <button
          onClick={() => openCompose()}
          className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#0494f4] text-white shadow-xl shadow-[#0494f4]/35 transition-transform active:scale-95 hover:bg-[#0382d6]"
          aria-label="Compose new message"
        >
          <PenTool className="h-5 w-5" />
        </button>
      </div>

      <nav
        className="fixed right-0 bottom-0 left-0 z-30 flex h-16 items-stretch justify-around border-t border-neutral-200 bg-white/95 px-1 pb-[env(safe-area-inset-bottom)] backdrop-blur-md select-none md:hidden dark:border-[#333333] dark:bg-[#212121]/95"
        aria-label="Mobile navigation"
      >
        {TABS.map(({ folder, label, icon: Icon }) => {
          const active = currentFolder === folder;
          return (
            <button
              key={folder}
              onClick={() => setCurrentFolder(folder)}
              aria-current={active ? 'page' : undefined}
              className={`relative flex h-full min-h-[48px] flex-1 flex-col items-center justify-center gap-0.5 transition-colors ${
                active ? 'text-[#0494f4]' : 'text-neutral-500 active:text-neutral-700 dark:text-neutral-400'
              }`}
            >
              <div className="relative">
                <Icon className="h-5 w-5" />
                {folder === 'inbox' && unreadInboxCount > 0 && (
                  <span className="absolute -top-1 -right-2 min-w-[16px] rounded-full bg-[#0494f4] px-1 text-[9px] font-bold leading-4 text-white">
                    {unreadInboxCount > 99 ? '99+' : unreadInboxCount}
                  </span>
                )}
              </div>
              <span className="text-[10px] font-bold tracking-tight">{label}</span>
              {active && <span className="absolute top-0 h-0.5 w-8 rounded-full bg-[#0494f4]" />}
            </button>
          );
        })}
      </nav>
    </>
  );
};
