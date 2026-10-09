import React from 'react';
import { Mail, Star, Send, PenTool, Database } from 'lucide-react';
import { useMail } from '../context/MailContext';

export const MobileBottomNav: React.FC = () => {
  const {
    currentFolder,
    setCurrentFolder,
    setSelectedLabel,
    openCompose,
    setIsSupabaseModalOpen,
    folderCounts,
    selectedEmailId,
  } = useMail();

  // If user is reading an email in mobile view, don't obstruct the reading experience
  if (selectedEmailId) return null;

  const handleNav = (folder: 'inbox' | 'starred' | 'sent') => {
    setCurrentFolder(folder);
    setSelectedLabel(null);
  };

  return (
    <>
      {/* Floating Action Button (FAB) for Compose - Native Gmail Position */}
      <div className="md:hidden fixed bottom-20 right-4 z-40">
        <button
          onClick={() => openCompose()}
          className="flex items-center gap-2 px-5 py-3.5 rounded-2xl bg-[#0494f4] hover:bg-[#0382d6] text-white shadow-xl shadow-[#0494f4]/35 active:scale-95 transition-all text-sm font-bold"
          aria-label="Compose new message"
        >
          <PenTool className="w-5 h-5 shrink-0" />
          <span>Compose</span>
        </button>
      </div>

      {/* Mobile Fixed Bottom Navigation Bar */}
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 z-30 bg-white/95 dark:bg-[#212121]/95 backdrop-blur-md border-t border-neutral-200 dark:border-[#333333] h-16 px-2 flex items-center justify-around select-none shadow-lg"
        aria-label="Mobile navigation"
      >
        {/* Mail / Inbox */}
        <button
          onClick={() => handleNav('inbox')}
          className={`flex flex-col items-center justify-center flex-1 h-full min-h-[48px] transition-colors relative ${
            currentFolder === 'inbox'
              ? 'text-[#0494f4]'
              : 'text-neutral-500 dark:text-neutral-400'
          }`}
        >
          <div className="relative">
            <Mail className="w-5 h-5" />
            {folderCounts.inbox > 0 && (
              <span className="absolute -top-1 -right-2 min-w-4 h-4 px-1 rounded-full bg-[#0494f4] text-white text-[10px] font-bold flex items-center justify-center">
                {folderCounts.inbox}
              </span>
            )}
          </div>
          <span className="text-[10px] font-bold mt-1 tracking-tight">Mail</span>
        </button>

        {/* Starred */}
        <button
          onClick={() => handleNav('starred')}
          className={`flex flex-col items-center justify-center flex-1 h-full min-h-[48px] transition-colors ${
            currentFolder === 'starred'
              ? 'text-[#0494f4]'
              : 'text-neutral-500 dark:text-neutral-400'
          }`}
        >
          <Star className="w-5 h-5" />
          <span className="text-[10px] font-bold mt-1 tracking-tight">Starred</span>
        </button>

        {/* Sent */}
        <button
          onClick={() => handleNav('sent')}
          className={`flex flex-col items-center justify-center flex-1 h-full min-h-[48px] transition-colors ${
            currentFolder === 'sent'
              ? 'text-[#0494f4]'
              : 'text-neutral-500 dark:text-neutral-400'
          }`}
        >
          <Send className="w-5 h-5" />
          <span className="text-[10px] font-bold mt-1 tracking-tight">Sent</span>
        </button>

        {/* Supabase */}
        <button
          onClick={() => setIsSupabaseModalOpen(true)}
          className="flex flex-col items-center justify-center flex-1 h-full min-h-[48px] text-neutral-500 dark:text-neutral-400 hover:text-[#0494f4] transition-colors"
        >
          <Database className="w-5 h-5 text-[#0494f4]" />
          <span className="text-[10px] font-bold mt-1 tracking-tight">Supabase</span>
        </button>
      </nav>
    </>
  );
};
