import React, { useState } from 'react';
import {
  X,
  Settings,
  Sun,
  Moon,
  Keyboard,
  Sliders,
  Check,
  FileSignature,
} from 'lucide-react';
import { useMail } from '../context/MailContext';

export const SettingsModal: React.FC = () => {
  const {
    isSettingsModalOpen,
    setIsSettingsModalOpen,
    theme,
    toggleTheme,
    showToast,
  } = useMail();

  const [density, setDensity] = useState<'default' | 'comfortable' | 'compact'>('default');
  const [undoSendTime, setUndoSendTime] = useState<'5' | '10' | '30'>('10');
  const [signature, setSignature] = useState('Best regards,\nPawan Gothwad\nSent from Gothwad Mail');

  if (!isSettingsModalOpen) return null;

  const handleSave = () => {
    showToast('Preferences saved');
    setIsSettingsModalOpen(false);
  };

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
              <h3 className="text-base font-bold text-neutral-900 dark:text-white">
                Gothwad Mail Settings
              </h3>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                Customize appearance, mailbox density, shortcuts and signature
              </p>
            </div>
          </div>

          <button
            onClick={() => setIsSettingsModalOpen(false)}
            className="p-1.5 rounded-full hover:bg-neutral-100 dark:hover:bg-[#2e2e2e] text-neutral-500"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 text-xs sm:text-sm space-y-6 text-neutral-800 dark:text-neutral-200">
          {/* Appearance & Color */}
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-neutral-400 mb-3 flex items-center gap-1.5">
              <Sun className="w-3.5 h-3.5 text-[#0494f4]" />
              Theme & Appearance
            </h4>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => {
                  if (theme !== 'light') toggleTheme();
                }}
                className={`p-3 rounded-xl border flex items-center gap-3 transition-colors ${
                  theme === 'light'
                    ? 'border-[#0494f4] bg-[#0494f4]/10 text-[#0494f4] font-bold'
                    : 'border-neutral-200 dark:border-[#383838] hover:bg-neutral-50 dark:hover:bg-[#282828]'
                }`}
              >
                <Sun className="w-4 h-4 text-[#0494f4]" />
                <div className="text-left">
                  <p className="font-semibold text-neutral-900 dark:text-white">Light Mode</p>
                  <p className="text-[11px] text-neutral-500 font-mono">Background #ffffff</p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => {
                  if (theme !== 'dark') toggleTheme();
                }}
                className={`p-3 rounded-xl border flex items-center gap-3 transition-colors ${
                  theme === 'dark'
                    ? 'border-[#0494f4] bg-[#0494f4]/10 text-[#0494f4] font-bold'
                    : 'border-neutral-200 dark:border-[#383838] hover:bg-neutral-50 dark:hover:bg-[#282828]'
                }`}
              >
                <Moon className="w-4 h-4 text-[#0494f4]" />
                <div className="text-left">
                  <p className="font-semibold text-neutral-900 dark:text-white">Dark Mode</p>
                  <p className="text-[11px] text-neutral-500 font-mono">Background #212121</p>
                </div>
              </button>
            </div>
          </div>

          {/* Display Density */}
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-neutral-400 mb-2 flex items-center gap-1.5">
              <Sliders className="w-3.5 h-3.5 text-[#0494f4]" />
              Display Density
            </h4>
            <div className="flex rounded-xl border border-neutral-200 dark:border-[#383838] overflow-hidden p-1 bg-neutral-50 dark:bg-[#282828]">
              {(['default', 'comfortable', 'compact'] as const).map((d) => (
                <button
                  key={d}
                  onClick={() => setDensity(d)}
                  className={`flex-1 py-1.5 capitalize rounded-lg text-xs font-semibold transition-colors ${
                    density === d
                      ? 'bg-white dark:bg-[#1e1e1e] text-[#0494f4] shadow-sm'
                      : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white'
                  }`}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>

          {/* Undo Send Time */}
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-neutral-400 mb-2">
              Undo Send Cancellation Window
            </h4>
            <div className="flex gap-3">
              {(['5', '10', '30'] as const).map((sec) => (
                <button
                  key={sec}
                  onClick={() => setUndoSendTime(sec)}
                  className={`px-4 py-2 rounded-xl border text-xs font-semibold ${
                    undoSendTime === sec
                      ? 'border-[#0494f4] bg-[#0494f4]/10 text-[#0494f4]'
                      : 'border-neutral-200 dark:border-[#383838] hover:bg-neutral-50 dark:hover:bg-[#282828]'
                  }`}
                >
                  {sec} seconds
                </button>
              ))}
            </div>
          </div>

          {/* Signature */}
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-neutral-400 mb-2 flex items-center gap-1.5">
              <FileSignature className="w-3.5 h-3.5 text-[#0494f4]" />
              Email Signature
            </h4>
            <textarea
              value={signature}
              onChange={(e) => setSignature(e.target.value)}
              rows={3}
              className="w-full p-3 rounded-xl border border-neutral-200 dark:border-[#383838] bg-white dark:bg-[#1e1e1e] text-xs font-mono focus:outline-none focus:border-[#0494f4]"
            />
          </div>

          {/* Keyboard Shortcuts */}
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-neutral-400 mb-2 flex items-center gap-1.5">
              <Keyboard className="w-3.5 h-3.5 text-[#0494f4]" />
              Active Keyboard Shortcuts
            </h4>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="flex items-center justify-between p-2 rounded-lg bg-neutral-50 dark:bg-[#282828]">
                <span>Compose new mail</span>
                <kbd className="px-2 py-0.5 rounded bg-neutral-200 dark:bg-[#383838] font-mono font-bold text-[#0494f4]">
                  c
                </kbd>
              </div>
              <div className="flex items-center justify-between p-2 rounded-lg bg-neutral-50 dark:bg-[#282828]">
                <span>Archive conversation</span>
                <kbd className="px-2 py-0.5 rounded bg-neutral-200 dark:bg-[#383838] font-mono font-bold text-[#0494f4]">
                  e
                </kbd>
              </div>
              <div className="flex items-center justify-between p-2 rounded-lg bg-neutral-50 dark:bg-[#282828]">
                <span>Move to Trash</span>
                <kbd className="px-2 py-0.5 rounded bg-neutral-200 dark:bg-[#383838] font-mono font-bold text-[#0494f4]">
                  #
                </kbd>
              </div>
              <div className="flex items-center justify-between p-2 rounded-lg bg-neutral-50 dark:bg-[#282828]">
                <span>Star / Unstar</span>
                <kbd className="px-2 py-0.5 rounded bg-neutral-200 dark:bg-[#383838] font-mono font-bold text-[#0494f4]">
                  s
                </kbd>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-neutral-200 dark:border-[#333333] flex items-center justify-end gap-2 bg-neutral-50/60 dark:bg-[#262626]">
          <button
            onClick={() => setIsSettingsModalOpen(false)}
            className="px-4 py-2 text-xs font-medium rounded-xl hover:bg-neutral-200 dark:hover:bg-[#333333]"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-5 py-2 text-xs font-bold rounded-xl bg-[#0494f4] hover:bg-[#0382d6] text-white transition-colors"
          >
            Save Preferences
          </button>
        </div>
      </div>
    </div>
  );
};
