import React from 'react';
import { X, Settings, Sun, Moon, Keyboard, HardDrive, Star, Trash2, Check } from 'lucide-react';
import { useMail } from '../context/MailContext';
import type { RetentionLimit } from '../services/mailApi';

// Only settings that really work are shown here. Density, undo-send and
// signature were removed: they were not saved or used anywhere, so showing
// them would be misleading.
const SHORTCUTS: Array<{ keys: string; label: string }> = [
  { keys: 'c', label: 'Compose new mail' },
  { keys: '#', label: 'Move to Trash (or delete forever in Trash)' },
  { keys: 's', label: 'Star / Unstar' },
  { keys: 'Esc', label: 'Close the open message' },
];

// The three values the Worker accepts. 0 means "Store All" up to the fair-use
// quota (50 MB of compressed mail per mailbox).
const RETENTION_CHOICES: Array<{ value: RetentionLimit; title: string; description: string }> = [
  {
    value: 500,
    title: 'Latest 500 emails (Default)',
    description: 'Automatically clears the oldest unstarred emails beyond 500.',
  },
  {
    value: 1500,
    title: 'Latest 1,500 emails',
    description: 'Keep up to 1,500 recent emails before older ones are cleared.',
  },
  {
    value: 0,
    title: 'Store All Emails',
    description: 'Keep everything while your mailbox stays under 50 MB (~25,000 emails).',
  },
];

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const SettingsModal: React.FC = () => {
  const {
    isSettingsModalOpen,
    setIsSettingsModalOpen,
    theme,
    toggleTheme,
    currentUser,
    accountUrl,
    mailboxSettings,
    isLoadingSettings,
    settingsError,
    refreshSettings,
    saveRetentionLimit,
  } = useMail();

  if (!isSettingsModalOpen) return null;

  const used = mailboxSettings?.storageUsedBytes ?? 0;
  const quota = mailboxSettings?.storageQuotaBytes ?? 50 * 1024 * 1024;
  const percent = quota > 0 ? Math.min(100, Math.round((used / quota) * 100)) : 0;

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
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                Storage, retention, appearance and shortcuts
              </p>
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
          {/* Mailbox storage + retention */}
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-neutral-400 mb-2 flex items-center gap-1.5">
              <HardDrive className="w-3.5 h-3.5 text-[#0494f4]" />
              Mailbox Storage &amp; Email Retention
            </h4>

            <div className="rounded-xl border border-neutral-200 dark:border-[#383838] p-3.5 space-y-3">
              {settingsError && (
                <div className="flex items-start justify-between gap-3 text-xs text-red-600 dark:text-red-400">
                  <span>{settingsError}</span>
                  <button onClick={refreshSettings} className="font-semibold underline shrink-0">
                    Retry
                  </button>
                </div>
              )}

              {/* Live usage bar */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[11px] font-semibold text-neutral-600 dark:text-neutral-300">
                  <span>
                    Used {formatBytes(used)} of {formatBytes(quota)}
                    {mailboxSettings
                      ? ` · ${mailboxSettings.totalMessages} email${mailboxSettings.totalMessages === 1 ? '' : 's'} · ${mailboxSettings.starredMessages} starred`
                      : ''}
                  </span>
                  <span className="text-[#0494f4]">{percent}%</span>
                </div>
                <div
                  className="h-2 w-full rounded-full bg-neutral-200 dark:bg-[#383838] overflow-hidden"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={percent}
                  aria-label="Mailbox storage used"
                >
                  <div
                    className="h-full rounded-full bg-[#0494f4] transition-all duration-300"
                    style={{ width: `${percent}%`, minWidth: used > 0 ? '4px' : '0' }}
                  />
                </div>
              </div>

              {/* Retention selector */}
              <div className="space-y-2" role="radiogroup" aria-label="Email retention">
                {RETENTION_CHOICES.map((choice) => {
                  const selected = mailboxSettings?.retentionLimit === choice.value;
                  return (
                    <button
                      key={choice.value}
                      role="radio"
                      aria-checked={selected}
                      disabled={isLoadingSettings}
                      onClick={() => {
                        if (!selected) void saveRetentionLimit(choice.value);
                      }}
                      className={`w-full text-left flex items-start gap-2.5 p-2.5 rounded-lg border transition-colors disabled:opacity-60 ${
                        selected
                          ? 'border-[#0494f4] bg-[#0494f4]/5 dark:bg-[#0494f4]/10'
                          : 'border-neutral-200 dark:border-[#383838] hover:bg-neutral-50 dark:hover:bg-[#282828]'
                      }`}
                    >
                      <span
                        className={`mt-0.5 w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${
                          selected ? 'border-[#0494f4] bg-[#0494f4]' : 'border-neutral-300 dark:border-[#555]'
                        }`}
                      >
                        {selected && <Check className="w-3 h-3 text-white" />}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-xs font-bold text-neutral-900 dark:text-white">
                          {choice.title}
                        </span>
                        <span className="block text-[11px] text-neutral-500 dark:text-neutral-400 leading-snug">
                          {choice.description}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>

              {isLoadingSettings && !mailboxSettings && (
                <p className="text-[11px] text-neutral-400">Loading your mailbox usage…</p>
              )}

              {/* Reassurance badge */}
              <div className="flex items-start gap-1.5 rounded-lg bg-[#0494f4]/10 dark:bg-[#0494f4]/10 px-2.5 py-2 text-[11px] text-neutral-700 dark:text-neutral-300">
                <Star className="w-3.5 h-3.5 text-[#0494f4] shrink-0 mt-px" />
                <span>
                  <b>Starred emails &amp; Drafts are never auto-deleted.</b>{' '}
                  <span className="inline-flex items-center gap-0.5">
                    <Trash2 className="w-3 h-3" /> Trash empties after 30 days.
                  </span>
                </span>
              </div>
            </div>
          </div>

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
