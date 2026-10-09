import React, { useState } from 'react';
import {
  X,
  Database,
  CheckCircle2,
  AlertCircle,
  Copy,
  Check,
  ExternalLink,
  RefreshCw,
  UploadCloud,
  FileCode,
  ShieldCheck,
  Server,
} from 'lucide-react';
import { useMail } from '../context/MailContext';
import {
  SUPABASE_SQL_SCHEMA,
  testSupabaseConnection,
} from '../services/supabaseService';

export const SupabaseModal: React.FC = () => {
  const {
    isSupabaseModalOpen,
    setIsSupabaseModalOpen,
    supabaseConfig,
    updateSupabaseConfig,
    showToast,
    emails,
  } = useMail();

  const [activeTab, setActiveTab] = useState<'connect' | 'schema' | 'architecture'>('connect');
  const [url, setUrl] = useState(supabaseConfig.url || '');
  const [anonKey, setAnonKey] = useState(supabaseConfig.anonKey || '');
  const [autoSync, setAutoSync] = useState(supabaseConfig.autoSync || false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [copied, setCopied] = useState(false);

  if (!isSupabaseModalOpen) return null;

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestResult(null);
    const res = await testSupabaseConnection(url.trim(), anonKey.trim());
    setTestResult(res);
    setIsTesting(false);
  };

  const handleSaveConfig = () => {
    updateSupabaseConfig({
      url: url.trim(),
      anonKey: anonKey.trim(),
      isConnected: testResult ? testResult.success : Boolean(url.trim() && anonKey.trim()),
      autoSync,
      lastSync: new Date().toLocaleTimeString(),
    });
    showToast('Supabase settings saved successfully');
    setIsSupabaseModalOpen(false);
  };

  const handleCopySql = () => {
    navigator.clipboard.writeText(SUPABASE_SQL_SCHEMA);
    setCopied(true);
    showToast('PostgreSQL SQL Schema copied to clipboard');
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/60 backdrop-blur-xs select-none">
      <div className="relative w-full max-w-2xl bg-white dark:bg-[#212121] rounded-2xl shadow-2xl border border-neutral-200 dark:border-[#383838] flex flex-col max-h-[90vh] overflow-hidden">
        {/* Modal Header */}
        <div className="px-5 py-4 border-b border-neutral-200 dark:border-[#333333] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#0494f4]/15 flex items-center justify-center text-[#0494f4]">
              <Database className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-bold text-neutral-900 dark:text-white">
                Supabase PostgreSQL Integration
              </h3>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                Configure database URL, keys, and execute schema for Gothwad Mail
              </p>
            </div>
          </div>

          <button
            onClick={() => setIsSupabaseModalOpen(false)}
            className="p-1.5 rounded-full hover:bg-neutral-100 dark:hover:bg-[#2e2e2e] text-neutral-500"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center px-5 border-b border-neutral-200 dark:border-[#333333] bg-neutral-50 dark:bg-[#262626]">
          <button
            onClick={() => setActiveTab('connect')}
            className={`py-3 px-4 text-xs font-semibold border-b-2 transition-colors ${
              activeTab === 'connect'
                ? 'border-[#0494f4] text-[#0494f4]'
                : 'border-transparent text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white'
            }`}
          >
            Connection & Credentials
          </button>
          <button
            onClick={() => setActiveTab('schema')}
            className={`py-3 px-4 text-xs font-semibold border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === 'schema'
                ? 'border-[#0494f4] text-[#0494f4]'
                : 'border-transparent text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white'
            }`}
          >
            <FileCode className="w-3.5 h-3.5" />
            SQL Schema Migration
          </button>
          <button
            onClick={() => setActiveTab('architecture')}
            className={`py-3 px-4 text-xs font-semibold border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === 'architecture'
                ? 'border-[#0494f4] text-[#0494f4]'
                : 'border-transparent text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white'
            }`}
          >
            <Server className="w-3.5 h-3.5" />
            Database Architecture
          </button>
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto p-5 text-sm space-y-4">
          {activeTab === 'connect' && (
            <div className="space-y-4">
              <div className="p-3.5 rounded-xl border border-neutral-200 dark:border-[#383838] bg-neutral-50/70 dark:bg-[#262626] text-xs text-neutral-600 dark:text-neutral-300 space-y-1.5">
                <div className="flex items-center gap-2 font-semibold text-neutral-900 dark:text-white">
                  <ShieldCheck className="w-4 h-4 text-[#0494f4]" />
                  <span>Ready for Supabase PostgreSQL Database</span>
                </div>
                <p>
                  Gothwad Mail stores all your emails, threads, labels, and drafts locally with seamless state persistence. Whenever you enter your Supabase credentials below, it automatically hooks up your database!
                </p>
              </div>

              <div>
                <label className="block text-xs font-bold text-neutral-700 dark:text-neutral-300 uppercase tracking-wide mb-1.5">
                  Supabase Project URL
                </label>
                <input
                  type="text"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://xyzabcdefg.supabase.co"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-neutral-300 dark:border-[#383838] bg-white dark:bg-[#1f1f1f] text-neutral-900 dark:text-white text-xs font-mono focus:outline-none focus:border-[#0494f4]"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-neutral-700 dark:text-neutral-300 uppercase tracking-wide mb-1.5">
                  Supabase Anon Public API Key
                </label>
                <input
                  type="password"
                  value={anonKey}
                  onChange={(e) => setAnonKey(e.target.value)}
                  placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                  className="w-full px-3.5 py-2.5 rounded-xl border border-neutral-300 dark:border-[#383838] bg-white dark:bg-[#1f1f1f] text-neutral-900 dark:text-white text-xs font-mono focus:outline-none focus:border-[#0494f4]"
                />
              </div>

              {/* Test Connection Result */}
              {testResult && (
                <div
                  className={`p-3 rounded-xl border flex items-start gap-2.5 text-xs ${
                    testResult.success
                      ? 'border-[#0494f4] bg-[#0494f4]/10 text-neutral-900 dark:text-white'
                      : 'border-neutral-400 bg-neutral-100 dark:bg-[#2b2b2b] text-neutral-800 dark:text-neutral-200'
                  }`}
                >
                  {testResult.success ? (
                    <CheckCircle2 className="w-4 h-4 text-[#0494f4] shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-neutral-500 shrink-0 mt-0.5" />
                  )}
                  <span>{testResult.message}</span>
                </div>
              )}

              {/* Status and Action Buttons */}
              <div className="pt-2 flex flex-wrap items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={handleTestConnection}
                  disabled={isTesting || !url || !anonKey}
                  className="px-4 py-2 rounded-xl border border-neutral-300 dark:border-[#383838] hover:border-[#0494f4] text-xs font-semibold text-neutral-800 dark:text-neutral-200 flex items-center gap-2 disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isTesting ? 'animate-spin' : ''}`} />
                  <span>{isTesting ? 'Testing connection...' : 'Test Connection'}</span>
                </button>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setUrl('');
                      setAnonKey('');
                      updateSupabaseConfig({
                        url: '',
                        anonKey: '',
                        isConnected: false,
                        autoSync: false,
                      });
                      setTestResult(null);
                      showToast('Supabase disconnected');
                    }}
                    className="px-3 py-2 text-xs font-semibold text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"
                  >
                    Clear Credentials
                  </button>

                  <button
                    type="button"
                    onClick={handleSaveConfig}
                    className="px-5 py-2 rounded-xl bg-[#0494f4] hover:bg-[#0382d6] text-white text-xs font-bold shadow-md shadow-[#0494f4]/20 transition-colors"
                  >
                    Save Configuration
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'schema' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-bold text-neutral-900 dark:text-white uppercase tracking-wider">
                    PostgreSQL Migration Script
                  </h4>
                  <p className="text-xs text-neutral-500 dark:text-neutral-400">
                    Copy and run this in your Supabase Project &gt; SQL Editor.
                  </p>
                </div>

                <button
                  onClick={handleCopySql}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#0494f4] hover:bg-[#0382d6] text-white text-xs font-bold shadow-sm transition-colors"
                >
                  {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copied ? 'Copied!' : 'Copy SQL Schema'}</span>
                </button>
              </div>

              <div className="relative">
                <pre className="p-4 rounded-xl border border-neutral-200 dark:border-[#383838] bg-neutral-900 text-neutral-100 font-mono text-[11px] leading-relaxed max-h-[360px] overflow-y-auto no-scrollbar selection:bg-[#0494f4] selection:text-white">
                  <code>{SUPABASE_SQL_SCHEMA}</code>
                </pre>
              </div>
            </div>
          )}

          {activeTab === 'architecture' && (
            <div className="space-y-4 text-xs text-neutral-700 dark:text-neutral-300">
              <h4 className="font-bold text-sm text-neutral-900 dark:text-white">
                How Gothwad Mail Works with Supabase
              </h4>
              <p>
                Gothwad Mail is engineered so you can freely plug in any incoming/outgoing email provider (SendGrid, Resend, Amazon SES, or custom SMTP server) via Supabase:
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                <div className="p-3 rounded-xl border border-neutral-200 dark:border-[#383838] bg-neutral-50 dark:bg-[#282828]">
                  <h5 className="font-bold text-neutral-900 dark:text-white mb-1 text-xs">
                    1. Incoming Emails (Inbound Webhook)
                  </h5>
                  <p className="text-[11px] text-neutral-500 dark:text-neutral-400 leading-relaxed">
                    Set up an Inbound Parse Webhook in Resend/SendGrid pointing to a Supabase Edge Function. When an email arrives, it inserts a record into <code>public.emails</code>.
                  </p>
                </div>

                <div className="p-3 rounded-xl border border-neutral-200 dark:border-[#383838] bg-neutral-50 dark:bg-[#282828]">
                  <h5 className="font-bold text-neutral-900 dark:text-white mb-1 text-xs">
                    2. Realtime Push
                  </h5>
                  <p className="text-[11px] text-neutral-500 dark:text-neutral-400 leading-relaxed">
                    With Supabase Realtime enabled on the <code>emails</code> table, new messages appear in Gothwad Mail instantly without page refreshes.
                  </p>
                </div>

                <div className="p-3 rounded-xl border border-neutral-200 dark:border-[#383838] bg-neutral-50 dark:bg-[#282828]">
                  <h5 className="font-bold text-neutral-900 dark:text-white mb-1 text-xs">
                    3. Outgoing Dispatch
                  </h5>
                  <p className="text-[11px] text-neutral-500 dark:text-neutral-400 leading-relaxed">
                    When you click <strong>Send</strong> in Gothwad Mail, the message is inserted with status <code>sent</code> and can trigger a PostgreSQL Database Webhook to dispatch via SMTP.
                  </p>
                </div>

                <div className="p-3 rounded-xl border border-neutral-200 dark:border-[#383838] bg-neutral-50 dark:bg-[#282828]">
                  <h5 className="font-bold text-neutral-900 dark:text-white mb-1 text-xs">
                    4. Security & Isolation
                  </h5>
                  <p className="text-[11px] text-neutral-500 dark:text-neutral-400 leading-relaxed">
                    Full PostgreSQL Row Level Security (RLS) ensures only authenticated users can access their personal mailbox folders and attachments.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
