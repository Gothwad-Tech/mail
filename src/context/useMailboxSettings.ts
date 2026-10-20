// =============================================================================
// Mailbox storage + retention settings (Cloudflare D1).
//
// Loaded when the Settings panel opens, and re-read after a change so the
// storage numbers on screen match what the Worker actually kept.
// =============================================================================

import { useCallback, useEffect, useState } from 'react';
import type { EmailFolder } from '../types/email';
import { mailApi, type MailboxSettings, type RetentionLimit } from '../services/mailApi';
import { errorText } from './mailHelpers';

interface UseMailboxSettingsOptions {
  isSettingsModalOpen: boolean;
  currentFolder: EmailFolder;
  loadFolder: (folder: EmailFolder, opts?: { force?: boolean }) => Promise<void>;
  showToast: (message: string) => void;
}

export function useMailboxSettings({
  isSettingsModalOpen,
  currentFolder,
  loadFolder,
  showToast,
}: UseMailboxSettingsOptions) {
  const [mailboxSettings, setMailboxSettings] = useState<MailboxSettings | null>(null);
  const [isLoadingSettings, setIsLoadingSettings] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);

  const refreshSettings = useCallback(async () => {
    setIsLoadingSettings(true);
    setSettingsError(null);
    try {
      setMailboxSettings(await mailApi.getSettings());
    } catch (err) {
      setSettingsError(errorText(err));
    } finally {
      setIsLoadingSettings(false);
    }
  }, []);

  // Load usage the first time the Settings panel opens, and again on demand.
  useEffect(() => {
    if (isSettingsModalOpen) void refreshSettings();
  }, [isSettingsModalOpen, refreshSettings]);

  const saveRetentionLimit = useCallback(
    async (limit: RetentionLimit): Promise<boolean> => {
      setIsLoadingSettings(true);
      setSettingsError(null);
      try {
        const next = await mailApi.updateSettings(limit);
        setMailboxSettings(next);
        const { trimmed, trashPurged } = next.cleanup;
        if (trimmed > 0 || trashPurged > 0) {
          showToast(
            `Retention updated: ${trimmed} old email${trimmed === 1 ? '' : 's'} removed` +
              (trashPurged > 0 ? `, ${trashPurged} from Trash` : '') +
              '. Starred emails and drafts were kept.'
          );
        } else {
          showToast('Retention updated.');
        }
        // Messages may have been trimmed, so refresh the list that is on screen.
        void loadFolder(currentFolder);
        return true;
      } catch (err) {
        setSettingsError(errorText(err));
        return false;
      } finally {
        setIsLoadingSettings(false);
      }
    },
    [currentFolder, loadFolder, showToast]
  );

  return { mailboxSettings, isLoadingSettings, settingsError, refreshSettings, saveRetentionLimit };
}

export type MailboxSettingsStore = ReturnType<typeof useMailboxSettings>;
