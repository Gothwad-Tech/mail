import React, { useState, useRef, useEffect } from 'react';
import {
  Menu,
  Search,
  X,
  SlidersHorizontal,
  Moon,
  Sun,
  Database,
  Settings,
  HardDrive,
  ExternalLink,
} from 'lucide-react';
import { useMail } from '../context/MailContext';
import { AccountSheet } from './AccountSheet';
import { PWAInstallButton } from './PWAInstallButton';

interface HeaderProps {
  onToggleSidebar: () => void;
}

export const Header: React.FC<HeaderProps> = ({ onToggleSidebar }) => {
  const {
    searchQuery,
    setSearchQuery,
    searchFilter,
    setSearchFilter,
    resetSearch,
    isSearchFilterOpen,
    setIsSearchFilterOpen,
    theme,
    toggleTheme,
    setIsSupabaseModalOpen,
    setIsSettingsModalOpen,
    setIsMobileNavOpen,
    supabaseConfig,
    currentUser,
  } = useMail();

  const [isAccountSheetOpen, setIsAccountSheetOpen] = useState(false);
  const searchFilterRef = useRef<HTMLDivElement>(null);

  // Close filter popover on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (searchFilterRef.current && !searchFilterRef.current.contains(event.target as Node)) {
        setIsSearchFilterOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [setIsSearchFilterOpen]);

  const hasActiveFilters =
    Boolean(searchFilter.from || searchFilter.to || searchFilter.subject || searchFilter.hasAttachment);

  return (
    <>
      {/* =========================================================================
          1. MOBILE TOP BAR (Matches Native Gmail App Floating Search Capsule)
      ========================================================================= */}
      <header className="md:hidden sticky top-0 z-30 w-full px-3 pt-2.5 pb-2 bg-white dark:bg-[#212121] select-none">
        <div
          ref={searchFilterRef}
          className="relative flex items-center h-12 w-full px-2 rounded-full bg-neutral-100 dark:bg-[#2b2b2b] border border-neutral-200/80 dark:border-[#383838] shadow-sm transition-all focus-within:bg-white dark:focus-within:bg-[#1e1e1e] focus-within:border-[#0494f4]"
        >
          {/* Hamburger Drawer Menu Button */}
          <button
            type="button"
            onClick={() => setIsMobileNavOpen(true)}
            className="flex items-center justify-center w-10 h-10 rounded-full hover:bg-neutral-200/60 dark:hover:bg-[#383838] text-neutral-600 dark:text-neutral-300 transition-colors shrink-0"
            aria-label="Open navigation drawer"
          >
            <Menu className="w-5 h-5" />
          </button>

          {/* Search Input */}
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search in mail"
            className="flex-1 bg-transparent px-2 text-sm text-neutral-900 dark:text-white placeholder-neutral-500 dark:placeholder-neutral-400 focus:outline-none min-w-0"
          />

          {/* Clear Button (if search text exists) */}
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="p-1.5 rounded-full hover:bg-neutral-200 dark:hover:bg-[#383838] text-neutral-500 shrink-0"
              aria-label="Clear search"
            >
              <X className="w-4 h-4" />
            </button>
          )}

          {/* Filter Popover Toggle */}
          <button
            type="button"
            onClick={() => setIsSearchFilterOpen(!isSearchFilterOpen)}
            className={`p-1.5 rounded-full shrink-0 transition-colors ${
              hasActiveFilters || isSearchFilterOpen
                ? 'text-[#0494f4]'
                : 'text-neutral-500 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-[#383838]'
            }`}
            aria-label="Search filters"
          >
            <SlidersHorizontal className="w-4 h-4" />
          </button>

          {/* User Profile Avatar (Opens Account Sheet on Mobile) */}
          <button
            type="button"
            onClick={() => setIsAccountSheetOpen(true)}
            className="w-8 h-8 rounded-full bg-[#0494f4] text-white flex items-center justify-center font-bold text-xs tracking-tight ml-1 shrink-0 shadow-sm"
            aria-label="Account details"
          >
            {currentUser.avatarText}
          </button>

          {/* Mobile Search Filter Dropdown */}
          {isSearchFilterOpen && (
            <div className="absolute top-13 left-0 right-0 bg-white dark:bg-[#1f1f1f] border border-neutral-200 dark:border-[#383838] rounded-2xl shadow-xl p-4 z-50 text-neutral-800 dark:text-neutral-200 animate-in fade-in slide-in-from-top-1 duration-150">
              <div className="flex items-center justify-between pb-2 border-b border-neutral-100 dark:border-[#2f2f2f] mb-3">
                <span className="text-xs font-bold uppercase tracking-wider text-neutral-400">
                  Search Filter
                </span>
                <button
                  onClick={() => setIsSearchFilterOpen(false)}
                  className="p-1 rounded text-neutral-400 hover:text-neutral-700"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-2.5 text-xs">
                <div>
                  <label className="text-neutral-500 dark:text-neutral-400 block mb-1">From</label>
                  <input
                    type="text"
                    value={searchFilter.from}
                    onChange={(e) => setSearchFilter({ ...searchFilter, from: e.target.value })}
                    placeholder="e.g. notifications@supabase.io"
                    className="w-full px-3 py-2 rounded-lg border border-neutral-200 dark:border-[#383838] bg-neutral-50 dark:bg-[#282828] focus:border-[#0494f4] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-neutral-500 dark:text-neutral-400 block mb-1">Subject</label>
                  <input
                    type="text"
                    value={searchFilter.subject}
                    onChange={(e) => setSearchFilter({ ...searchFilter, subject: e.target.value })}
                    placeholder="Subject keywords..."
                    className="w-full px-3 py-2 rounded-lg border border-neutral-200 dark:border-[#383838] bg-neutral-50 dark:bg-[#282828] focus:border-[#0494f4] focus:outline-none"
                  />
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <input
                    type="checkbox"
                    id="mobHasAtt"
                    checked={searchFilter.hasAttachment}
                    onChange={(e) =>
                      setSearchFilter({ ...searchFilter, hasAttachment: e.target.checked })
                    }
                    className="w-4 h-4 rounded text-[#0494f4] accent-[#0494f4]"
                  />
                  <label htmlFor="mobHasAtt" className="cursor-pointer">
                    Has attachment
                  </label>
                </div>
              </div>

              <div className="flex items-center justify-between mt-4 pt-3 border-t border-neutral-100 dark:border-[#2f2f2f]">
                <button
                  type="button"
                  onClick={resetSearch}
                  className="text-xs font-semibold text-neutral-500 hover:text-neutral-900"
                >
                  Reset
                </button>
                <button
                  type="button"
                  onClick={() => setIsSearchFilterOpen(false)}
                  className="px-4 py-1.5 text-xs font-bold rounded-lg bg-[#0494f4] text-white hover:bg-[#0382d6]"
                >
                  Search
                </button>
              </div>
            </div>
          )}
        </div>
      </header>

      {/* =========================================================================
          2. DESKTOP TOP BAR (Classic Gmail 3-Pane Desktop Header)
      ========================================================================= */}
      <header className="hidden md:flex sticky top-0 z-30 h-16 w-full border-b border-neutral-200 dark:border-[#333333] bg-white dark:bg-[#212121] px-5 items-center justify-between gap-4 select-none">
        {/* Left Zone: Hamburger + Gothwad Mail Monogram */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={onToggleSidebar}
            className="flex items-center justify-center w-10 h-10 rounded-full hover:bg-neutral-100 dark:hover:bg-[#2a2a2a] text-neutral-600 dark:text-neutral-300 transition-colors"
            aria-label="Toggle sidebar"
          >
            <Menu className="w-5 h-5" />
          </button>

          <div className="flex items-center gap-2.5 cursor-pointer">
            <div className="w-9 h-9 rounded-xl bg-[#0494f4] flex items-center justify-center text-white shadow-sm shadow-[#0494f4]/20">
              <svg
                className="w-5 h-5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.3"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect width="20" height="16" x="2" y="4" rx="3" />
                <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
              </svg>
            </div>
            <span className="text-lg font-bold tracking-tight text-neutral-900 dark:text-white leading-none">
              Gothwad<span className="text-[#0494f4] font-semibold ml-1">Mail</span>
            </span>
          </div>
        </div>

        {/* Center Zone: Search Box */}
        <div className="flex-1 max-w-2xl relative mx-2" ref={searchFilterRef}>
          <div
            className={`flex items-center w-full h-11 px-4 rounded-2xl border transition-all ${
              isSearchFilterOpen || searchQuery
                ? 'border-[#0494f4] bg-white dark:bg-[#1c1c1c] shadow-sm'
                : 'border-transparent bg-neutral-100 dark:bg-[#2a2a2a] hover:bg-neutral-200/80 dark:hover:bg-[#303030]'
            }`}
          >
            <Search className="w-4 h-4 text-neutral-500 dark:text-neutral-400 shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search in mail"
              className="w-full bg-transparent px-3 text-sm text-neutral-900 dark:text-neutral-100 placeholder-neutral-500 dark:placeholder-neutral-400 focus:outline-none"
            />

            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="p-1 rounded-full hover:bg-neutral-200 dark:hover:bg-[#383838] text-neutral-500 transition-colors mr-1"
                aria-label="Clear search"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}

            <button
              onClick={() => setIsSearchFilterOpen(!isSearchFilterOpen)}
              className={`p-1.5 rounded-full transition-colors relative ${
                hasActiveFilters || isSearchFilterOpen
                  ? 'bg-[#0494f4]/15 text-[#0494f4]'
                  : 'hover:bg-neutral-200 dark:hover:bg-[#383838] text-neutral-500 dark:text-neutral-400'
              }`}
              aria-label="Toggle search options"
            >
              <SlidersHorizontal className="w-4 h-4" />
              {hasActiveFilters && (
                <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-[#0494f4]" />
              )}
            </button>
          </div>

          {/* Desktop Search Filter Popover */}
          {isSearchFilterOpen && (
            <div className="absolute top-13 left-0 right-0 bg-white dark:bg-[#1f1f1f] border border-neutral-200 dark:border-[#383838] rounded-2xl shadow-xl p-5 z-50 text-neutral-800 dark:text-neutral-200">
              <h3 className="text-xs font-bold text-neutral-400 dark:text-neutral-500 uppercase tracking-wider mb-3">
                Search Options
              </h3>
              <div className="space-y-3 text-sm">
                <div className="grid grid-cols-3 items-center gap-3">
                  <label className="text-neutral-500 dark:text-neutral-400 font-medium">From</label>
                  <input
                    type="text"
                    value={searchFilter.from}
                    onChange={(e) => setSearchFilter({ ...searchFilter, from: e.target.value })}
                    placeholder="e.g. notifications@supabase.io"
                    className="col-span-2 w-full px-3 py-1.5 rounded-lg border border-neutral-200 dark:border-[#383838] bg-neutral-50 dark:bg-[#282828] focus:border-[#0494f4] focus:outline-none"
                  />
                </div>

                <div className="grid grid-cols-3 items-center gap-3">
                  <label className="text-neutral-500 dark:text-neutral-400 font-medium">To</label>
                  <input
                    type="text"
                    value={searchFilter.to}
                    onChange={(e) => setSearchFilter({ ...searchFilter, to: e.target.value })}
                    placeholder="e.g. pwngtwd@gmail.com"
                    className="col-span-2 w-full px-3 py-1.5 rounded-lg border border-neutral-200 dark:border-[#383838] bg-neutral-50 dark:bg-[#282828] focus:border-[#0494f4] focus:outline-none"
                  />
                </div>

                <div className="grid grid-cols-3 items-center gap-3">
                  <label className="text-neutral-500 dark:text-neutral-400 font-medium">Subject</label>
                  <input
                    type="text"
                    value={searchFilter.subject}
                    onChange={(e) => setSearchFilter({ ...searchFilter, subject: e.target.value })}
                    placeholder="Keywords in subject"
                    className="col-span-2 w-full px-3 py-1.5 rounded-lg border border-neutral-200 dark:border-[#383838] bg-neutral-50 dark:bg-[#282828] focus:border-[#0494f4] focus:outline-none"
                  />
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <input
                    type="checkbox"
                    id="deskHasAtt"
                    checked={searchFilter.hasAttachment}
                    onChange={(e) =>
                      setSearchFilter({ ...searchFilter, hasAttachment: e.target.checked })
                    }
                    className="w-4 h-4 rounded text-[#0494f4] accent-[#0494f4] cursor-pointer"
                  />
                  <label htmlFor="deskHasAtt" className="cursor-pointer text-neutral-700 dark:text-neutral-300">
                    Has attachment
                  </label>
                </div>
              </div>

              <div className="flex items-center justify-between mt-5 pt-3 border-t border-neutral-100 dark:border-[#303030]">
                <button
                  type="button"
                  onClick={resetSearch}
                  className="text-xs font-semibold text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"
                >
                  Reset filters
                </button>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsSearchFilterOpen(false)}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg hover:bg-neutral-100 dark:hover:bg-[#2d2d2d]"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsSearchFilterOpen(false)}
                    className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-[#0494f4] hover:bg-[#0382d6] text-white"
                  >
                    Apply Search
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right Zone: Supabase, Theme, Settings, Profile */}
        <div className="flex items-center gap-2 shrink-0">
          <PWAInstallButton />

          <button
            onClick={() => setIsSupabaseModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-neutral-200 dark:border-[#383838] hover:border-[#0494f4] dark:hover:border-[#0494f4] bg-neutral-50 dark:bg-[#282828] text-xs font-semibold text-neutral-700 dark:text-neutral-200 transition-colors"
            title="Supabase Database Settings & SQL Schema"
          >
            <Database className="w-3.5 h-3.5 text-[#0494f4]" />
            <span>Supabase</span>
            <span
              className={`w-2 h-2 rounded-full ${
                supabaseConfig.isConnected ? 'bg-[#0494f4]' : 'bg-neutral-400 dark:bg-neutral-500'
              }`}
            />
          </button>

          <button
            onClick={toggleTheme}
            className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-neutral-100 dark:hover:bg-[#2a2a2a] text-neutral-600 dark:text-neutral-300 transition-colors"
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            title={theme === 'dark' ? 'Light mode (#ffffff)' : 'Dark mode (#212121)'}
          >
            {theme === 'dark' ? <Sun className="w-5 h-5 text-[#0494f4]" /> : <Moon className="w-5 h-5 text-neutral-700" />}
          </button>

          <button
            onClick={() => setIsSettingsModalOpen(true)}
            className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-neutral-100 dark:hover:bg-[#2a2a2a] text-neutral-600 dark:text-neutral-300 transition-colors"
            aria-label="Settings"
          >
            <Settings className="w-5 h-5" />
          </button>

          <button
            onClick={() => setIsAccountSheetOpen(true)}
            className="w-10 h-10 rounded-full bg-[#0494f4] text-white flex items-center justify-center font-bold text-sm tracking-tight shadow-sm hover:opacity-90 transition-opacity"
            aria-label="User profile"
          >
            {currentUser.avatarText}
          </button>
        </div>
      </header>

      {/* Account & Workspace Dialog Sheet */}
      <AccountSheet
        isOpen={isAccountSheetOpen}
        onClose={() => setIsAccountSheetOpen(false)}
      />
    </>
  );
};
