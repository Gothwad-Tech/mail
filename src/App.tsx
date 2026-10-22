import React, { useState, useEffect, lazy, Suspense } from 'react';
import { MailProvider, useMail } from './context/MailContext';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { EmailList } from './components/EmailList';
import { EmailDetail } from './components/EmailDetail';
import { MobileBottomNav } from './components/MobileBottomNav';
import { MobileDrawer } from './components/MobileDrawer';
import { Toast } from './components/Toast';
import { OfflineIndicator } from './components/OfflineIndicator';
import { useSession } from './hooks/useSession';
import { folderFromHash, hashForFolder } from './services/authuser';
import { preloadAccountWidget } from './services/accountWidget';

// Compose and Settings are only needed after a tap. Loading them on demand keeps
// the first paint (inbox) small.
const ComposeModal = lazy(() =>
  import('./components/ComposeModal').then((m) => ({ default: m.ComposeModal }))
);
const SettingsModal = lazy(() =>
  import('./components/SettingsModal').then((m) => ({ default: m.SettingsModal }))
);

const MainLayout: React.FC = () => {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const {
    selectedEmailId,
    setSelectedEmailId,
    splitView,
    openCompose,
    deleteEmails,
    toggleStar,
    selectedIds,
    composeState,
    unreadInboxCount,
    isSettingsModalOpen,
    currentFolder,
    setCurrentFolder,
  } = useMail();

  // The folder lives in the URL hash (`/u/1/#sent`), so a refresh, a shared link
  // and Back/Forward all land on the same folder of the same account.
  useEffect(() => {
    const fromHash = folderFromHash();
    if (fromHash !== 'inbox') setCurrentFolder(fromHash);
    const params = new URLSearchParams(window.location.search);
    if (params.get('compose') === '1') {
      openCompose();
      params.delete('compose');
      const qs = params.toString();
      window.history.replaceState(
        window.history.state,
        '',
        `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`
      );
    }
    // Intentionally once, on mount: the URL is the input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the hash in step with the folder the user is looking at.
  useEffect(() => {
    const next = hashForFolder(currentFolder);
    if (window.location.hash !== next) {
      window.history.replaceState(
        window.history.state,
        '',
        `${window.location.pathname}${window.location.search}${next}`
      );
    }
  }, [currentFolder]);

  // Unread count in the tab title, like every mail app. Only the inbox counts.
  useEffect(() => {
    document.title = unreadInboxCount > 0 ? `(${unreadInboxCount}) Gothwad Mail` : 'Gothwad Mail';
  }, [unreadInboxCount]);

  // Keyboard shortcuts: 'c' compose, '#' move to Trash (or delete forever in Trash),
  // 's' star, Esc close, '/' focus search.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger while the user is typing or a dialog is open.
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable ||
        composeState.isOpen ||
        isSettingsModalOpen
      ) {
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === 'c' || e.key === 'C') {
        e.preventDefault();
        openCompose();
      } else if (e.key === '#') {
        if (selectedEmailId) {
          e.preventDefault();
          deleteEmails([selectedEmailId]);
        } else if (selectedIds.length > 0) {
          e.preventDefault();
          deleteEmails(selectedIds);
        }
      } else if (e.key === 's' || e.key === 'S') {
        if (selectedEmailId) {
          e.preventDefault();
          toggleStar(selectedEmailId);
        }
      } else if (e.key === 'Escape') {
        if (selectedEmailId) setSelectedEmailId(null);
      } else if (e.key === '/') {
        const search = document.querySelector<HTMLInputElement>('input[type="search"], input[placeholder*="Search"]');
        if (search) {
          e.preventDefault();
          search.focus();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    selectedEmailId,
    selectedIds,
    composeState.isOpen,
    isSettingsModalOpen,
    openCompose,
    deleteEmails,
    toggleStar,
    setSelectedEmailId,
  ]);

  return (
    // 100dvh (not 100vh) so mobile browser chrome never pushes the composer off
    // screen. Every child below is flex-based, so no magic pixel heights.
    <div className="flex h-[100dvh] max-h-[100dvh] w-full flex-col overflow-hidden bg-white text-neutral-900 antialiased font-sans dark:bg-[#212121] dark:text-neutral-100">
      <Header onToggleSidebar={() => setIsSidebarCollapsed((prev) => !prev)} />

      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        {/* Desktop collapsible sidebar (hidden on mobile, drawer takes over) */}
        <Sidebar isCollapsed={isSidebarCollapsed} />

        {/* Mobile navigation drawer */}
        <MobileDrawer />

        <main
          className={`flex min-h-0 min-w-0 flex-1 overflow-hidden ${
            // Leave room for the mobile bottom bar only while the list is shown.
            selectedEmailId ? '' : 'pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0'
          }`}
        >
          {splitView === 'vertical' ? (
            <div className="flex h-full w-full min-w-0 flex-1 overflow-hidden">
              <div className="h-full w-1/2 min-w-0 overflow-hidden border-r border-neutral-200 dark:border-[#333333]">
                <EmailList />
              </div>
              <div className="h-full w-1/2 min-w-0 overflow-hidden">
                {selectedEmailId ? (
                  <EmailDetail />
                ) : (
                  <div className="flex h-full select-none flex-col items-center justify-center gap-2 p-6 text-center text-neutral-400">
                    <p className="text-sm font-semibold">Select an email to read</p>
                    <p className="text-xs text-neutral-500">The reading pane stays on the right.</p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="h-full min-w-0 flex-1 overflow-hidden">
              {selectedEmailId ? <EmailDetail /> : <EmailList />}
            </div>
          )}
        </main>
      </div>

      <Suspense fallback={null}>
        {/* Mounted only when opened, so the first load ships less JavaScript. */}
        {composeState.isOpen && <ComposeModal />}
        {isSettingsModalOpen && <SettingsModal />}
      </Suspense>

      <MobileBottomNav />

      <Toast />
      <OfflineIndicator />
    </div>
  );
};

/** Full-screen message used while we check the session or when it fails. */
const Screen: React.FC<{ title: string; detail?: string; onRetry?: () => void }> = ({ title, detail, onRetry }) => (
  <div className="flex h-[100dvh] w-full flex-col items-center justify-center gap-3 bg-white p-6 text-center text-neutral-700 dark:bg-[#212121] dark:text-neutral-200">
    <div className="mb-1 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#0494f4]/12 text-[#0494f4]">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-6 w-6">
        <rect width="20" height="16" x="2" y="4" rx="3" />
        <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
      </svg>
    </div>
    <p className="text-base font-semibold">{title}</p>
    {detail && <p className="max-w-md text-sm text-neutral-500">{detail}</p>}
    {onRetry && (
      <button
        onClick={onRetry}
        className="mt-2 rounded-full bg-[#0494f4] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#0382d6]"
      >
        Try again
      </button>
    )}
  </div>
);

export default function App() {
  // Auth gate: nothing private renders until the Worker confirms the Accounts session.
  const { state, retry, refresh, applyAccount } = useSession();

  // Warm the shared account widget while the inbox paints, so the first avatar
  // tap opens the sheet with no network wait. Quietly ignored if it fails: the
  // sheet falls back to the in-app menu.
  const accountsWebOrigin = state.status === 'ready' ? state.info.accountsWebOrigin ?? '' : '';
  useEffect(() => {
    if (accountsWebOrigin) preloadAccountWidget(accountsWebOrigin);
  }, [accountsWebOrigin]);

  if (state.status === 'loading') return <Screen title="Checking your Gothwad account…" />;
  if (state.status === 'redirecting') return <Screen title="Redirecting you to sign in…" />;
  if (state.status === 'error') {
    return <Screen title="Can't open Gothwad Mail" detail={state.message} onRetry={retry} />;
  }

  const { info } = state;
  return (
    <MailProvider
      // Keyed by account slot: switching remounts the provider, so no cached
      // list, detail body or draft can leak across accounts. The mailbox cache
      // itself is per slot (services/mailboxCache.ts), so the remount still
      // paints that account's last inbox instantly.
      key={info.activeId ?? `u${info.authuser}`}
      user={info.user}
      sendRemainingToday={info.limits.sendRemainingToday}
      dailySendLimit={info.limits.dailySendLimit}
      accountUrl={info.accountUrl}
      accountsWebOrigin={info.accountsWebOrigin ?? ''}
      authuser={info.authuser}
      activeId={info.activeId}
      accounts={info.accounts}
      unread={info.unread}
      onSessionChanged={refresh}
      onSwitchAccount={applyAccount}
    >
      <MainLayout />
    </MailProvider>
  );
}
