import React from 'react';
import { X, Settings, Sun, Moon, Keyboard } from 'lucide-react';
import { useMail } from '../context/MailContext';

// Only settings that really work are shown here. Density, undo-send and
// signature were removed: they were not saved or used anywhere, so showing
// them would be misleading.
const SHORTCUTS: Array<{ keys: string; label: string }> = [
  { keys: 'c', label: 'Compose new mail' },
  { keys: '#', label: 'Move to Trash (or delete forever in Trash)' },
  { keys: 's', label: 'Star / Unstar' },
  { keys: 'Esc', label: 'Close the open message' },
];

export const SettingsModal: React.FC = () => {
  const { isSettingsModalOpen, setIsSettingsModalOpen, theme, toggleTheme, currentUser, accountUrl } = useMail();

  if (!isSettingsModalOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/60 backdrop-blur-xs select-none">
      <div className="relative w-full max-w-xl bg-white dark:bg-[#212121] rounded-2xl shadow-2xl border border-neutral-200 dark:border-[#383838] flex flex-col max-h-[85vh] overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-neutral-200 dark:border-[#333333] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#0494f4]/15 flex items-center justify-center text-[#0494f4]">
              <Settings className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-bold text-neutral-900 dark:text-white">Gothwad Mail Settings</h3>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">Appearance and keyboard shortcuts</p>
            </div>
          </div>

          <button
            onClick={() => setIsSettingsModalOpen(false)}
            className="p-1.5 rounded-full hover:bg-neutral-100 dark:hover:bg-[#2e2e2e] text-neutral-500"
            aria-label="Close settings"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 overflow-y-auto space-y-6">
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-neutral-400 mb-2">Theme</h4>
            <button
              onClick={toggleTheme}
              className="flex items-center gap-2 px-4 py-2 rounded-xl border border-neutral-200 dark:border-[#383838] hover:bg-neutral-50 dark:hover:bg-[#282828] text-xs font-semibold text-neutral-800 dark:text-neutral-200"
            >
              {theme === 'dark' ? <Sun className="w-4 h-4 text-[#0494f4]" /> : <Moon className="w-4 h-4 text-[#0494f4]" />}
              {theme === 'dark' ? 'Switch to Light (#ffffff)' : 'Switch to Dark (#212121)'}
            </button>
          </div>

          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-neutral-400 mb-2">Account</h4>
            <p className="text-xs text-neutral-600 dark:text-neutral-300">
              Signed in as <span className="font-semibold">{currentUser.email}</span>.{' '}
              <a href={accountUrl} target="_blank" rel="noreferrer" className="text-[#0494f4] hover:underline">
                Manage your Gothwad Account
              </a>
            </p>
          </div>

          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-neutral-400 mb-2 flex items-center gap-1.5">
              <Keyboard className="w-3.5 h-3.5 text-[#0494f4]" />
              Keyboard Shortcuts
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
              {SHORTCUTS.map((s) => (
                <div
                  key={s.keys}
                  className="flex items-center justify-between p-2 rounded-lg bg-neutral-50 dark:bg-[#282828] gap-2"
                >
                  <span>{s.label}</span>
                  <kbd className="px-2 py-0.5 rounded bg-neutral-200 dark:bg-[#383838] font-mono font-bold text-[#0494f4]">
                    {s.keys}
                  </kbd>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-neutral-200 dark:border-[#333333] flex items-center justify-end bg-neutral-50/60 dark:bg-[#262626]">
          <button
            onClick={() => setIsSettingsModalOpen(false)}
            className="px-5 py-2 text-xs font-bold rounded-xl bg-[#0494f4] hover:bg-[#0382d6] text-white transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
