import React, { useState } from 'react';
import {
  Inbox,
  Star,
  Clock,
  Send,
  FileText,
  AlertOctagon,
  Trash2,
  Bookmark,
  Calendar,
  Mail,
  Plus,
  Tag,
  PenTool,
  Database,
  HardDrive,
  ChevronDown,
  ChevronRight,
  Folder,
} from 'lucide-react';
import { useMail } from '../context/MailContext';
import { EmailFolder } from '../types/email';

interface SidebarProps {
  isCollapsed: boolean;
}

export const Sidebar: React.FC<SidebarProps> = ({ isCollapsed }) => {
  const {
    currentFolder,
    setCurrentFolder,
    selectedLabel,
    setSelectedLabel,
    folderCounts,
    openCompose,
    labels,
    createLabel,
    currentUser,
    setIsSupabaseModalOpen,
    supabaseConfig,
  } = useMail();

  const [isLabelsExpanded, setIsLabelsExpanded] = useState(true);
  const [isCreatingLabel, setIsCreatingLabel] = useState(false);
  const [newLabelName, setNewLabelName] = useState('');

  const primaryNavItems: Array<{
    folder: EmailFolder;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    count?: number;
  }> = [
    { folder: 'inbox', label: 'Inbox', icon: Inbox, count: folderCounts.inbox },
    { folder: 'starred', label: 'Starred', icon: Star, count: folderCounts.starred },
    { folder: 'snoozed', label: 'Snoozed', icon: Clock, count: folderCounts.snoozed },
    { folder: 'sent', label: 'Sent', icon: Send },
    { folder: 'drafts', label: 'Drafts', icon: FileText, count: folderCounts.drafts },
    { folder: 'important', label: 'Important', icon: Bookmark, count: folderCounts.important },
    { folder: 'scheduled', label: 'Scheduled', icon: Calendar },
    { folder: 'all', label: 'All Mail', icon: Mail },
    { folder: 'spam', label: 'Spam', icon: AlertOctagon, count: folderCounts.spam },
    { folder: 'trash', label: 'Trash', icon: Trash2 },
  ];

  const handleSelectFolder = (folder: EmailFolder) => {
    setCurrentFolder(folder);
    setSelectedLabel(null);
  };

  const handleSelectLabel = (label: string) => {
    setSelectedLabel(label);
  };

  const handleCreateLabelSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (newLabelName.trim()) {
      createLabel(newLabelName.trim());
      setNewLabelName('');
      setIsCreatingLabel(false);
    }
  };

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

      {/* Navigation Items (Scrollable) */}
      <div className="flex-1 overflow-y-auto no-scrollbar space-y-1">
        {primaryNavItems.map((item) => {
          const Icon = item.icon;
          const isActive = currentFolder === item.folder && selectedLabel === null;

          return (
            <button
              key={item.folder}
              onClick={() => handleSelectFolder(item.folder)}
              className={`w-full flex items-center justify-between rounded-full transition-colors ${
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
                {!isCollapsed && (
                  <span className="text-sm truncate font-medium">{item.label}</span>
                )}
              </div>

              {!isCollapsed && item.count !== undefined && item.count > 0 && (
                <span
                  className={`text-xs tabular-nums font-bold px-2 py-0.5 rounded-full ${
                    isActive
                      ? 'bg-[#0494f4] text-white'
                      : 'text-neutral-600 dark:text-neutral-400'
                  }`}
                >
                  {item.count}
                </span>
              )}
            </button>
          );
        })}

        {/* Labels Section Divider */}
        {!isCollapsed && (
          <div className="pt-4 pb-2">
            <div className="px-3 flex items-center justify-between text-xs font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">
              <button
                onClick={() => setIsLabelsExpanded(!isLabelsExpanded)}
                className="flex items-center gap-1.5 hover:text-neutral-800 dark:hover:text-neutral-200"
              >
                {isLabelsExpanded ? (
                  <ChevronDown className="w-3.5 h-3.5" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5" />
                )}
                <span>Labels</span>
              </button>

              <button
                onClick={() => setIsCreatingLabel(true)}
                className="p-1 rounded hover:bg-neutral-100 dark:hover:bg-[#2e2e2e] text-neutral-600 dark:text-neutral-400"
                title="Create new label"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Create Label Form */}
            {isCreatingLabel && (
              <form onSubmit={handleCreateLabelSubmit} className="mt-2 px-2">
                <div className="flex items-center gap-1.5 bg-neutral-100 dark:bg-[#2a2a2a] rounded-lg p-1">
                  <input
                    type="text"
                    value={newLabelName}
                    onChange={(e) => setNewLabelName(e.target.value)}
                    placeholder="New label name..."
                    autoFocus
                    className="w-full bg-transparent text-xs px-2 py-1 text-neutral-900 dark:text-neutral-100 focus:outline-none"
                  />
                  <button
                    type="submit"
                    className="px-2 py-1 bg-[#0494f4] text-white rounded text-[11px] font-semibold hover:bg-[#0382d6]"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsCreatingLabel(false)}
                    className="px-1.5 py-1 text-[11px] text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
                  >
                    ✕
                  </button>
                </div>
              </form>
            )}

            {/* Labels List */}
            {isLabelsExpanded && (
              <div className="mt-1 space-y-0.5">
                {labels.map((lbl) => {
                  const isSelected = selectedLabel === lbl;
                  return (
                    <button
                      key={lbl}
                      onClick={() => handleSelectLabel(lbl)}
                      className={`w-full flex items-center gap-3 px-4 h-8 rounded-full text-xs font-medium transition-colors ${
                        isSelected
                          ? 'bg-[#0494f4]/15 text-[#0494f4] font-bold'
                          : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-[#2a2a2a]'
                      }`}
                    >
                      <Tag
                        className={`w-3.5 h-3.5 ${
                          isSelected ? 'text-[#0494f4]' : 'text-neutral-400'
                        }`}
                      />
                      <span className="truncate">{lbl}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Bottom Area: Supabase Card & Storage */}
      {!isCollapsed && (
        <div className="py-3 border-t border-neutral-200 dark:border-[#333333] space-y-3">
          {/* Supabase Connection Card */}
          <div
            onClick={() => setIsSupabaseModalOpen(true)}
            className="p-2.5 rounded-xl border border-neutral-200 dark:border-[#333333] hover:border-[#0494f4] dark:hover:border-[#0494f4] bg-neutral-50 dark:bg-[#282828] cursor-pointer transition-colors"
          >
            <div className="flex items-center justify-between mb-1">
              <span className="flex items-center gap-1.5 text-xs font-semibold text-neutral-800 dark:text-neutral-200">
                <Database className="w-3.5 h-3.5 text-[#0494f4]" />
                Supabase Engine
              </span>
              <span
                className={`text-[10px] font-bold px-1.5 py-0.2 rounded ${
                  supabaseConfig.isConnected
                    ? 'bg-[#0494f4]/20 text-[#0494f4]'
                    : 'bg-neutral-200 dark:bg-[#383838] text-neutral-600 dark:text-neutral-400'
                }`}
              >
                {supabaseConfig.isConnected ? 'Connected' : 'Setup Ready'}
              </span>
            </div>
            <p className="text-[11px] text-neutral-500 dark:text-neutral-400 leading-tight">
              PostgreSQL schema & sync ready
            </p>
          </div>

          {/* Storage Meter */}
          <div className="px-1 text-xs text-neutral-500 dark:text-neutral-400">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px]">Storage used</span>
              <span className="font-mono tabular-nums text-[11px]">
                {currentUser.storageUsedGb} GB of {currentUser.storageTotalGb} GB
              </span>
            </div>
            <div className="w-full h-1.5 bg-neutral-100 dark:bg-[#2d2d2d] rounded-full overflow-hidden">
              <div
                className="h-full bg-[#0494f4] rounded-full"
                style={{
                  width: `${(currentUser.storageUsedGb / currentUser.storageTotalGb) * 100}%`,
                }}
              />
            </div>
          </div>
        </div>
      )}
    </aside>
  );
};
