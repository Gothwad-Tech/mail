import React from 'react';
import {
  X,
  HardDrive,
  Database,
  Settings,
  Sun,
  Moon,
  ExternalLink,
  ShieldCheck,
  Check,
} from 'lucide-react';
import { useMail } from '../context/MailContext';
import { PWAInstallButton } from './PWAInstallButton';

interface AccountSheetProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AccountSheet: React.FC<AccountSheetProps> = ({ isOpen, onClose }) => {
  const {
    currentUser,
    theme,
    toggleTheme,
    setIsSupabaseModalOpen,
    setIsSettingsModalOpen,
    supabaseConfig,
  } = useMail();

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-xs select-none">
      {/* Backdrop */}
      <div className="fixed inset-0" onClick={onClose} />

      {/* Surface */}
      <div className="relative w-full sm:max-w-md bg-white dark:bg-[#212121] rounded-t-3xl sm:rounded-2xl shadow-2xl border border-neutral-200 dark:border-[#383838] p-5 z-10 animate-in slide-in-from-bottom duration-200">
        {/* Grab handle on mobile */}
        <div className="sm:hidden w-10 h-1 bg-neutral-300 dark:bg-neutral-600 rounded-full mx-auto mb-4" />

        {/* Top bar with close button */}
        <div className="flex items-center justify-between pb-3 border-b border-neutral-100 dark:border-[#2f2f2f]">
          <span className="text-xs font-bold uppercase tracking-wider text-neutral-400">
            Gothwad Account
          </span>
          <button
            onClick={onClose}
            className="p-1 rounded-full hover:bg-neutral-100 dark:hover:bg-[#2e2e2e] text-neutral-500"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* User Profile Card */}
        <div className="py-4 flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-full bg-[#0494f4] text-white flex items-center justify-center font-bold text-lg shadow-sm">
            {currentUser.avatarText}
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-bold text-sm text-neutral-900 dark:text-white truncate">
              {currentUser.name}
            </h3>
            <p className="text-xs text-neutral-500 dark:text-neutral-400 truncate">
              {currentUser.email}
            </p>
            <div className="mt-1 flex items-center gap-1.5">
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#0494f4]/15 text-[#0494f4]">
                <ShieldCheck className="w-3 h-3" />
                Workspace Active
              </span>
            </div>
          </div>
        </div>

        {/* Storage Bar */}
        <div className="p-3.5 rounded-2xl bg-neutral-50 dark:bg-[#282828] border border-neutral-200 dark:border-[#333333] mb-4">
          <div className="flex items-center justify-between text-xs text-neutral-600 dark:text-neutral-400 mb-2">
            <span className="flex items-center gap-1.5 font-medium">
              <HardDrive className="w-4 h-4 text-[#0494f4]" />
              Account Storage
            </span>
            <span className="font-mono tabular-nums text-[11px]">
              {currentUser.storageUsedGb} GB of {currentUser.storageTotalGb} GB used
            </span>
          </div>
          <div className="w-full h-2 bg-neutral-200 dark:bg-[#383838] rounded-full overflow-hidden">
            <div
              className="h-full bg-[#0494f4] rounded-full transition-all"
              style={{
                width: `${(currentUser.storageUsedGb / currentUser.storageTotalGb) * 100}%`,
              }}
            />
          </div>
        </div>

        {/* Quick Actions List */}
        <div className="space-y-1.5">
          <PWAInstallButton className="w-full justify-center py-2.5" />

          {/* Supabase Status Button */}
          <button
            onClick={() => {
              onClose();
              setIsSupabaseModalOpen(true);
            }}
            className="w-full flex items-center justify-between p-3 rounded-xl border border-neutral-200 dark:border-[#333333] hover:border-[#0494f4] dark:hover:border-[#0494f4] bg-white dark:bg-[#262626] text-xs font-semibold text-neutral-800 dark:text-neutral-200 transition-colors"
          >
            <div className="flex items-center gap-2.5">
              <Database className="w-4 h-4 text-[#0494f4]" />
              <div className="text-left">
                <p>Supabase PostgreSQL DB</p>
                <p className="text-[10px] text-neutral-400 font-normal">
                  {supabaseConfig.isConnected ? 'Connected & Synced' : 'Ready to configure credentials'}
                </p>
              </div>
            </div>
            <span
              className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                supabaseConfig.isConnected
                  ? 'bg-[#0494f4]/20 text-[#0494f4]'
                  : 'bg-neutral-100 dark:bg-[#383838] text-neutral-500'
              }`}
            >
              {supabaseConfig.isConnected ? 'Connected' : 'Setup'}
            </span>
          </button>

          {/* Theme Switcher Button */}
          <button
            onClick={toggleTheme}
            className="w-full flex items-center justify-between p-3 rounded-xl border border-neutral-200 dark:border-[#333333] hover:bg-neutral-50 dark:hover:bg-[#282828] text-xs font-semibold text-neutral-800 dark:text-neutral-200 transition-colors"
          >
            <div className="flex items-center gap-2.5">
              {theme === 'dark' ? (
                <Sun className="w-4 h-4 text-[#0494f4]" />
              ) : (
                <Moon className="w-4 h-4 text-[#0494f4]" />
              )}
              <div className="text-left">
                <p>Theme: {theme === 'dark' ? 'Dark Mode (#212121)' : 'Light Mode (#ffffff)'}</p>
                <p className="text-[10px] text-neutral-400 font-normal">
                  Tap to switch to {theme === 'dark' ? 'Light' : 'Dark'}
                </p>
              </div>
            </div>
            <span className="text-xs text-[#0494f4] font-bold">Toggle</span>
          </button>

          {/* Settings Button */}
          <button
            onClick={() => {
              onClose();
              setIsSettingsModalOpen(true);
            }}
            className="w-full flex items-center justify-between p-3 rounded-xl border border-neutral-200 dark:border-[#333333] hover:bg-neutral-50 dark:hover:bg-[#282828] text-xs font-semibold text-neutral-800 dark:text-neutral-200 transition-colors"
          >
            <div className="flex items-center gap-2.5">
              <Settings className="w-4 h-4 text-neutral-500" />
              <span>Gothwad Mail Preferences</span>
            </div>
            <ExternalLink className="w-3.5 h-3.5 text-neutral-400" />
          </button>
        </div>

        <div className="mt-4 pt-3 border-t border-neutral-100 dark:border-[#2f2f2f] text-center">
          <p className="text-[11px] text-neutral-400 font-medium">
            Gothwad Mail v1.0 · Powered by Supabase
          </p>
        </div>
      </div>
    </div>
  );
};
