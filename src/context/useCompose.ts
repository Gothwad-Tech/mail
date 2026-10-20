// =============================================================================
// Compose window: open/close/minimise, send, and the draft autosave loop.
//
// The autosave is deliberately serialised (one request at a time) and only
// writes when the content actually changed, so a fast typist never creates
// duplicate drafts. Split out of MailContext.tsx; the logic is unchanged.
// =============================================================================

import { useCallback, useRef, useState } from 'react';
import type { ComposeData, EmailFolder } from '../types/email';
import { mailApi } from '../services/mailApi';
import { errorText } from './mailHelpers';
import { EMPTY_COMPOSE, type ComposeState } from './mailContextTypes';

interface UseComposeOptions {
  showToast: (message: string) => void;
  currentFolder: EmailFolder;
  loadFolder: (folder: EmailFolder, opts?: { force?: boolean }) => Promise<void>;
  setSendRemainingToday: (value: number | null) => void;
}

export function useCompose({ showToast, currentFolder, loadFolder, setSendRemainingToday }: UseComposeOptions) {
  const [composeState, setComposeState] = useState<ComposeState>({
    isOpen: false,
    isMinimized: false,
    isMaximized: false,
    data: EMPTY_COMPOSE,
  });

  // Refs used by the draft saver. They avoid stale closures in timers.
  const composeOpenRef = useRef(false);
  const draftIdRef = useRef<string | null>(null);
  const lastDraftKeyRef = useRef<string>('');
  const pendingDraftRef = useRef<ComposeData | null>(null);
  const draftFlushingRef = useRef(false);

  const openCompose = useCallback((initialData?: Partial<ComposeData>) => {
    composeOpenRef.current = true;
    draftIdRef.current = initialData?.id ?? null;
    lastDraftKeyRef.current = JSON.stringify({ ...EMPTY_COMPOSE, ...initialData, id: undefined });
    setComposeState({
      isOpen: true,
      isMinimized: false,
      isMaximized: false,
      data: {
        id: initialData?.id,
        to: initialData?.to || [],
        cc: initialData?.cc || [],
        bcc: initialData?.bcc || [],
        subject: initialData?.subject || '',
        body: initialData?.body || '',
      },
    });
  }, []);

  const closeCompose = useCallback(() => {
    composeOpenRef.current = false;
    pendingDraftRef.current = null;
    draftIdRef.current = null;
    lastDraftKeyRef.current = '';
    setComposeState((prev) => ({ ...prev, isOpen: false }));
  }, []);

  const minimizeCompose = useCallback(() => {
    setComposeState((prev) => ({ ...prev, isMinimized: !prev.isMinimized }));
  }, []);

  const maximizeCompose = useCallback(() => {
    setComposeState((prev) => ({ ...prev, isMaximized: !prev.isMaximized }));
  }, []);

  const setComposeData = useCallback((data: ComposeData) => {
    setComposeState((prev) => ({ ...prev, data }));
  }, []);

  const sendEmail = useCallback(
    async (data: ComposeData): Promise<boolean> => {
      if (data.to.length === 0) {
        showToast('Add at least one recipient.');
        return false;
      }
      try {
        const res = await mailApi.send({
          to: data.to,
          cc: data.cc,
          bcc: data.bcc,
          subject: data.subject,
          body: data.body,
          draftId: data.id ?? draftIdRef.current ?? undefined,
        });
        setSendRemainingToday(res.remainingToday);
        closeCompose();
        showToast('Message sent');
        if (currentFolder === 'sent' || currentFolder === 'drafts') void loadFolder(currentFolder);
        return true;
      } catch (err) {
        showToast(errorText(err));
        return false;
      }
    },
    [closeCompose, currentFolder, loadFolder, setSendRemainingToday, showToast]
  );

  /**
   * Autosave. ComposeModal calls this on every change (debounced there).
   * We only send a request when something actually changed, and we never run
   * two saves at once, so a fast typist cannot create duplicate drafts.
   */
  const flushDrafts = useCallback(async () => {
    if (draftFlushingRef.current) return;
    draftFlushingRef.current = true;
    try {
      while (pendingDraftRef.current) {
        const data = pendingDraftRef.current;
        pendingDraftRef.current = null;
        if (!composeOpenRef.current) break;

        const key = JSON.stringify({ ...data, id: undefined });
        if (key === lastDraftKeyRef.current) continue;

        const isEmpty =
          !data.subject.trim() && !data.body.trim() && data.to.length === 0 && data.cc.length === 0 && data.bcc.length === 0;
        if (isEmpty) {
          // Empty compose: remove the draft we made earlier, if any.
          if (draftIdRef.current) {
            const id = draftIdRef.current;
            draftIdRef.current = null;
            await mailApi.deleteDraft(id).catch(() => undefined);
          }
          lastDraftKeyRef.current = key;
          continue;
        }

        try {
          const { message } = await mailApi.saveDraft({ ...data, id: data.id ?? draftIdRef.current ?? undefined });
          draftIdRef.current = message.id;
          lastDraftKeyRef.current = key;
          setComposeState((prev) => (prev.isOpen ? { ...prev, data: { ...prev.data, id: message.id } } : prev));
        } catch (err) {
          // Keep the text in the compose window. Show the error once.
          showToast(errorText(err));
        }
      }
    } finally {
      draftFlushingRef.current = false;
    }
  }, [showToast]);

  const saveDraft = useCallback(
    (data: ComposeData) => {
      if (!composeOpenRef.current) return;
      pendingDraftRef.current = data;
      void flushDrafts();
    },
    [flushDrafts]
  );

  const discardCompose = useCallback(() => {
    const id = draftIdRef.current;
    closeCompose();
    if (id) {
      mailApi.deleteDraft(id).catch(() => undefined);
      if (currentFolder === 'drafts') void loadFolder('drafts');
    }
  }, [closeCompose, currentFolder, loadFolder]);

  return {
    composeState,
    openCompose,
    closeCompose,
    discardCompose,
    minimizeCompose,
    maximizeCompose,
    setComposeData,
    sendEmail,
    saveDraft,
  };
}

export type ComposeStore = ReturnType<typeof useCompose>;
