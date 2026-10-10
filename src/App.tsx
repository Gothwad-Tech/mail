import React, { useState, useEffect } from 'react';
import { MailProvider, useMail } from './context/MailContext';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { EmailList } from './components/EmailList';
import { EmailDetail } from './components/EmailDetail';
import { ComposeModal } from './components/ComposeModal';
import { MobileBottomNav } from './components/MobileBottomNav';
import { MobileDrawer } from './components/MobileDrawer';
import { SettingsModal } from './components/SettingsModal';
import { Toast } from './components/Toast';
import { OfflineIndicator } from './components/OfflineIndicator';
import { useSession } from './hooks/useSession';

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
  } = useMail();

  // Keyboard shortcuts: 'c' compose, '#' move to Trash (or delete forever in Trash), 's' star, Esc close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if user is actively typing in an input or textarea
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable ||
        composeState.isOpen
      ) {
        return;
      }

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
        if (selectedEmailId) {
          setSelectedEmailId(null);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    selectedEmailId,
    selectedIds,
    composeState.isOpen,
    openCompose,
    deleteEmails,
    toggleStar,
    setSelectedEmailId,
  ]);

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-white dark:bg-[#212121] text-neutral-900 dark:text-neutral-100 font-sans antialiased">
      {/* Top Header */}
      <Header onToggleSidebar={() => setIsSidebarCollapsed((prev) => !prev)} />

      {/* Main Workspace Frame */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Desktop Collapsible Sidebar */}
        <Sidebar isCollapsed={isSidebarCollapsed} />

        {/* Mobile Navigation Drawer */}
        <MobileDrawer />

        {/* Mail Content Area */}
        <main
          className={`flex-1 flex h-[calc(100vh-4.25rem)] overflow-hidden ${
            selectedEmailId ? 'pb-0' : 'pb-16 md:pb-0'
          }`}
        >
          {/* Layout Decision: Split View vs Standard View */}
          {splitView === 'vertical' ? (
            <div className="flex-1 flex w-full h-full overflow-hidden">
              <div className="w-1/2 border-r border-neutral-200 dark:border-[#333333] h-full overflow-hidden">
                <EmailList />
              </div>
              <div className="w-1/2 h-full overflow-hidden">
                {selectedEmailId ? (
                  <EmailDetail />
                ) : (
                  <div className="flex flex-col items-center justify-center h-full text-neutral-400 p-6 text-center select-none">
                    <p className="text-sm font-semibold">Select an email to view details</p>
                    <p className="text-xs text-neutral-500 mt-1">
                      Vertical preview pane enabled
                    </p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* Standard Full-Width / Single View */
            <div className="flex-1 h-full overflow-hidden">
              {selectedEmailId ? <EmailDetail /> : <EmailList />}
            </div>
          )}
        </main>
      </div>

      {/* Floating Compose Modal */}
      <ComposeModal />

      {/* Mobile Bottom Navigation Bar */}
      <MobileBottomNav />

      {/* Settings Modal */}
      <SettingsModal />

      {/* Toast Notification Container */}
      <Toast />

      {/* PWA Offline Indicator */}
      <OfflineIndicator />
    </div>
  );
};

/** Full-screen message used while we check the session or when it fails. */
const Screen: React.FC<{ title: string; detail?: string; onRetry?: () => void }> = ({ title, detail, onRetry }) => (
  <div className="flex flex-col items-center justify-center h-screen w-screen gap-3 bg-white dark:bg-[#212121] text-neutral-700 dark:text-neutral-200 p-6 text-center">
    <p className="text-base font-semibold">{title}</p>
    {detail && <p className="text-sm text-neutral-500 max-w-md">{detail}</p>}
    {onRetry && (
      <button
        onClick={onRetry}
        className="mt-2 px-4 py-2 rounded-full bg-[#0494f4] hover:bg-[#0382d6] text-white text-sm font-semibold"
      >
        Try again
      </button>
    )}
  </div>
);

export default function App() {
  // Auth gate: nothing private renders until the Worker confirms the Accounts session.
  const { state, retry } = useSession();

  if (state.status === 'loading') return <Screen title="Checking your Gothwad account…" />;
  if (state.status === 'redirecting') return <Screen title="Redirecting you to sign in…" />;
  if (state.status === 'error') {
    return <Screen title="Can't open Gothwad Mail" detail={state.message} onRetry={retry} />;
  }

  const { info } = state;
  return (
    <MailProvider
      user={info.user}
      sendRemainingToday={info.limits.sendRemainingToday}
      dailySendLimit={info.limits.dailySendLimit}
      accountUrl={info.accountUrl}
    >
      <MainLayout />
    </MailProvider>
  );
}
