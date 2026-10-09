import React, { useState } from 'react';
import {
  X,
  Inbox,
  Star,
  Clock,
  Send,
  FileText,
  Bookmark,
  Mail,
  AlertOctagon,
  Trash2,
  Tag,
  Plus,
  Database,
  Moon,
  Sun,
  Settings,
  Users,
  BadgePercent,
  Info,
  MessageSquare,
  ShieldCheck,
} from 'lucide-react';
import { useMail } from '../context/MailContext';
import { EmailFolder, EmailCategory } from '../types/email';

export const MobileDrawer: React.FC = () => {
  const {
    isMobileNavOpen,
    setIsMobileNavOpen,
    currentFolder,
    setCurrentFolder,
    currentCategory,
    setCurrentCategory,
    selectedLabel,
    setSelectedLabel,
    folderCounts,
    categoryCounts,
    labels,
    createLabel,
    theme,
    toggleTheme,
    setIsSupabaseModalOpen,
    setIsSettingsModalOpen,
    currentUser,
  } = useMail();

  const [newLabelInput, setNewLabelInput] = useState('');
  const [showAddLabel, setShowAddLabel] = useState(false);

  if (!isMobileNavOpen) return null;

  const handleSelectFolder = (folder: EmailFolder) => {
    setCurrentFolder(folder);
    setSelectedLabel(null);
    setIsMobileNavOpen(false);
  };

  const handleSelectCategory = (cat: EmailCategory) => {
    setCurrentFolder('inbox');
    setCurrentCategory(cat);
    setSelectedLabel(null);
    setIsMobileNavOpen(false);
  };

  const handleSelectLabel = (label: string) => {
    setSelectedLabel(label);
    setIsMobileNavOpen(false);
  };

  const handleAddLabel = (e: React.FormEvent) => {
    e.preventDefault();
    if (newLabelInput.trim()) {
      createLabel(newLabelInput.trim());
      setNewLabelInput('');
      setShowAddLabel(false);
    }
  };

  const categoryItems: Array<{
    cat: EmailCategory;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    count: number;
  }> = [
    { cat: 'primary', label: 'Primary', icon: Inbox, count: categoryCounts.primary },
    { cat: 'social', label: 'Social', icon: Users, count: categoryCounts.social },
    { cat: 'promotions', label: 'Promotions', icon: BadgePercent, count: categoryCounts.promotions },
    { cat: 'updates', label: 'Updates', icon: Info, count: categoryCounts.updates },
    { cat: 'forums', label: 'Forums', icon: MessageSquare, count: categoryCounts.forums },
  ];

  const standardFolders: Array<{
    folder: EmailFolder;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    count?: number;
  }> = [
    { folder: 'starred', label: 'Starred', icon: Star, count: folderCounts.starred },
    { folder: 'snoozed', label: 'Snoozed', icon: Clock, count: folderCounts.snoozed },
    { folder: 'important', label: 'Important', icon: Bookmark, count: folderCounts.important },
    { folder: 'sent', label: 'Sent', icon: Send },
    { folder: 'drafts', label: 'Drafts', icon: FileText, count: folderCounts.drafts },
    { folder: 'all', label: 'All Mail', icon: Mail },
    { folder: 'spam', label: 'Spam', icon: AlertOctagon, count: folderCounts.spam },
    { folder: 'trash', label: 'Trash', icon: Trash2 },
  ];

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

        {/* User Card */}
        <div className="px-4 py-3 bg-neutral-50 dark:bg-[#262626] border-b border-neutral-200 dark:border-[#333333] flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-[#0494f4] text-white flex items-center justify-center font-bold text-xs shadow-xs">
            {currentUser.avatarText}
          </div>
          <div className="min-w-0">
            <p className="text-xs font-bold text-neutral-900 dark:text-white truncate">
              {currentUser.name}
            </p>
            <p className="text-[11px] text-neutral-500 dark:text-neutral-400 truncate">
              {currentUser.email}
            </p>
          </div>
        </div>

        {/* Scrollable Navigation Sections */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {/* Inbox Categories */}
          <div className="px-3 pt-2 pb-1 text-[11px] font-bold text-neutral-400 uppercase tracking-wider">
            All Inboxes
          </div>
          {categoryItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentFolder === 'inbox' && currentCategory === item.cat && selectedLabel === null;

            return (
              <button
                key={item.cat}
                onClick={() => handleSelectCategory(item.cat)}
                className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-full text-xs font-medium transition-colors ${
                  isActive
                    ? 'bg-[#0494f4]/15 text-[#0494f4] font-bold'
                    : 'text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-[#2b2b2b]'
                }`}
              >
                <div className="flex items-center gap-3">
                  <Icon className={`w-4 h-4 ${isActive ? 'text-[#0494f4]' : 'text-neutral-500'}`} />
                  <span>{item.label}</span>
                </div>
                {item.count > 0 && (
                  <span
                    className={`text-[10px] font-bold tabular-nums px-2 py-0.5 rounded-full ${
                      isActive
                        ? 'bg-[#0494f4] text-white'
                        : 'bg-neutral-100 dark:bg-[#333333] text-neutral-600 dark:text-neutral-400'
                    }`}
                  >
                    {item.count}
                  </span>
                )}
              </button>
            );
          })}

          {/* All Labels & Folders */}
          <div className="px-3 pt-3 pb-1 text-[11px] font-bold text-neutral-400 uppercase tracking-wider border-t border-neutral-100 dark:border-[#2e2e2e] mt-2">
            All Folders
          </div>
          {standardFolders.map((item) => {
            const Icon = item.icon;
            const isActive = currentFolder === item.folder && selectedLabel === null;

            return (
              <button
                key={item.folder}
                onClick={() => handleSelectFolder(item.folder)}
                className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-full text-xs font-medium transition-colors ${
                  isActive
                    ? 'bg-[#0494f4]/15 text-[#0494f4] font-bold'
                    : 'text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-[#2b2b2b]'
                }`}
              >
                <div className="flex items-center gap-3">
                  <Icon className={`w-4 h-4 ${isActive ? 'text-[#0494f4]' : 'text-neutral-500'}`} />
                  <span>{item.label}</span>
                </div>
                {item.count !== undefined && item.count > 0 && (
                  <span
                    className={`text-[10px] font-bold tabular-nums px-2 py-0.5 rounded-full ${
                      isActive
                        ? 'bg-[#0494f4] text-white'
                        : 'bg-neutral-100 dark:bg-[#333333] text-neutral-600 dark:text-neutral-400'
                    }`}
                  >
                    {item.count}
                  </span>
                )}
              </button>
            );
          })}

          {/* Custom Labels Section */}
          <div className="pt-3 pb-1 border-t border-neutral-100 dark:border-[#2e2e2e] mt-2">
            <div className="px-3 flex items-center justify-between text-[11px] font-bold text-neutral-400 uppercase tracking-wider mb-1">
              <span>Labels</span>
              <button
                onClick={() => setShowAddLabel(!showAddLabel)}
                className="p-1 text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>

            {showAddLabel && (
              <form onSubmit={handleAddLabel} className="p-2">
                <input
                  type="text"
                  value={newLabelInput}
                  onChange={(e) => setNewLabelInput(e.target.value)}
                  placeholder="Label name..."
                  autoFocus
                  className="w-full text-xs p-2 rounded-lg border border-neutral-200 dark:border-[#383838] bg-neutral-50 dark:bg-[#2a2a2a] focus:outline-none focus:border-[#0494f4]"
                />
              </form>
            )}

            {labels.map((lbl) => {
              const isSelected = selectedLabel === lbl;
              return (
                <button
                  key={lbl}
                  onClick={() => handleSelectLabel(lbl)}
                  className={`w-full flex items-center gap-3 px-3.5 py-2 rounded-full text-xs transition-colors ${
                    isSelected
                      ? 'bg-[#0494f4]/15 text-[#0494f4] font-bold'
                      : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-[#2b2b2b]'
                  }`}
                >
                  <Tag className={`w-3.5 h-3.5 ${isSelected ? 'text-[#0494f4]' : 'text-neutral-400'}`} />
                  <span>{lbl}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Bottom Drawer Actions */}
        <div className="p-3 border-t border-neutral-200 dark:border-[#333333] space-y-2">
          {/* Supabase Button */}
          <button
            onClick={() => {
              setIsMobileNavOpen(false);
              setIsSupabaseModalOpen(true);
            }}
            className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl bg-neutral-100 dark:bg-[#282828] text-xs font-semibold text-neutral-800 dark:text-neutral-200"
          >
            <span className="flex items-center gap-2">
              <Database className="w-4 h-4 text-[#0494f4]" />
              Supabase PostgreSQL Setup
            </span>
            <span className="text-[10px] text-[#0494f4] font-bold">Configure</span>
          </button>

          {/* Theme & Settings Buttons */}
          <div className="flex items-center gap-2">
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
    </div>
  );
};
