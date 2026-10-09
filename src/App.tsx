import React, { useState, useEffect } from 'react';
import { MailProvider, useMail } from './context/MailContext';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { EmailList } from './components/EmailList';
import { EmailDetail } from './components/EmailDetail';
import { ComposeModal } from './components/ComposeModal';
import { MobileBottomNav } from './components/MobileBottomNav';
import { MobileDrawer } from './components/MobileDrawer';
import { SupabaseModal } from './components/SupabaseModal';
import { SettingsModal } from './components/SettingsModal';
import { Toast } from './components/Toast';
import { OfflineIndicator } from './components/OfflineIndicator';

const MainLayout: React.FC = () => {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const {
    selectedEmailId,
    setSelectedEmailId,
    splitView,
    openCompose,
    archiveEmails,
    deleteEmails,
    toggleStar,
    selectedIds,
    composeState,
  } = useMail();

  // Keyboard shortcuts handler ('c' for compose, 'e' for archive, '#' for delete, 's' for star)
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
      } else if (e.key === 'e' || e.key === 'E') {
        if (selectedEmailId) {
          e.preventDefault();
          archiveEmails([selectedEmailId]);
        } else if (selectedIds.length > 0) {
          e.preventDefault();
          archiveEmails(selectedIds);
        }
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
    archiveEmails,
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

      {/* Supabase Database Setup & SQL Modal */}
      <SupabaseModal />

      {/* Settings Modal */}
      <SettingsModal />

      {/* Toast Notification Container */}
      <Toast />

      {/* PWA Offline Indicator */}
      <OfflineIndicator />
    </div>
  );
};

export default function App() {
  return (
    <MailProvider>
      <MainLayout />
    </MailProvider>
  );
}
