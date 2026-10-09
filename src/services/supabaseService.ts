import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { EmailMessage, SupabaseConfig } from '../types/email';

const STORAGE_KEY = 'gothwad_mail_supabase_config';
const EMAILS_LOCAL_KEY = 'gothwad_mail_local_emails';

export const SUPABASE_SQL_SCHEMA = `-- =========================================================================
-- GOTHWAD MAIL - COMPLETE POSTGRESQL DATABASE SCHEMA FOR SUPABASE
-- Run this in your Supabase Project SQL Editor to provision all tables!
-- =========================================================================

-- 1. Create Enums for Categories and Folders
DO $$ BEGIN
  CREATE TYPE email_category AS ENUM ('primary', 'social', 'promotions', 'updates', 'forums');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE email_folder AS ENUM (
    'inbox', 'starred', 'snoozed', 'sent', 'drafts', 
    'important', 'scheduled', 'all', 'spam', 'trash', 'archive'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- 2. Create Emails Table
CREATE TABLE IF NOT EXISTS public.emails (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  sender_name TEXT NOT NULL,
  sender_email TEXT NOT NULL,
  sender_avatar TEXT,
  to_recipients TEXT[] NOT NULL DEFAULT '{}',
  cc_recipients TEXT[] DEFAULT '{}',
  bcc_recipients TEXT[] DEFAULT '{}',
  subject TEXT NOT NULL DEFAULT '(no subject)',
  snippet TEXT DEFAULT '',
  body_html TEXT NOT NULL,
  body_text TEXT DEFAULT '',
  timestamp TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  date_formatted TEXT,
  is_read BOOLEAN NOT NULL DEFAULT false,
  is_starred BOOLEAN NOT NULL DEFAULT false,
  is_snoozed BOOLEAN NOT NULL DEFAULT false,
  is_archived BOOLEAN NOT NULL DEFAULT false,
  is_deleted BOOLEAN NOT NULL DEFAULT false,
  is_draft BOOLEAN NOT NULL DEFAULT false,
  is_spam BOOLEAN NOT NULL DEFAULT false,
  is_important BOOLEAN NOT NULL DEFAULT false,
  category email_category NOT NULL DEFAULT 'primary',
  folder email_folder NOT NULL DEFAULT 'inbox',
  labels TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 3. Create Attachments Table
CREATE TABLE IF NOT EXISTS public.attachments (
  id TEXT PRIMARY KEY,
  email_id TEXT NOT NULL REFERENCES public.emails(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  size TEXT NOT NULL,
  type TEXT NOT NULL,
  url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 4. Create Custom Labels Table
CREATE TABLE IF NOT EXISTS public.labels (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  color_hex TEXT NOT NULL DEFAULT '#0494f4',
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 5. Create Performance Indexes for Lightning-Fast Queries
CREATE INDEX IF NOT EXISTS idx_emails_thread_id ON public.emails(thread_id);
CREATE INDEX IF NOT EXISTS idx_emails_folder ON public.emails(folder);
CREATE INDEX IF NOT EXISTS idx_emails_category ON public.emails(category);
CREATE INDEX IF NOT EXISTS idx_emails_timestamp ON public.emails(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_emails_is_read ON public.emails(is_read);
CREATE INDEX IF NOT EXISTS idx_emails_is_starred ON public.emails(is_starred);
CREATE INDEX IF NOT EXISTS idx_emails_to_recipients ON public.emails USING GIN(to_recipients);
CREATE INDEX IF NOT EXISTS idx_emails_labels ON public.emails USING GIN(labels);

-- 6. Enable Row Level Security (RLS)
ALTER TABLE public.emails ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.labels ENABLE ROW LEVEL SECURITY;

-- 7. RLS Permissive Development Policies (You can restrict by auth.uid() in production)
CREATE POLICY "Allow public read access to emails" 
  ON public.emails FOR SELECT USING (true);

CREATE POLICY "Allow public insert/update to emails" 
  ON public.emails FOR ALL USING (true);

CREATE POLICY "Allow public access to attachments" 
  ON public.attachments FOR ALL USING (true);

CREATE POLICY "Allow public access to labels" 
  ON public.labels FOR ALL USING (true);

-- 8. Enable Realtime Replication
ALTER PUBLICATION supabase_realtime ADD TABLE public.emails;
`;

export function getStoredSupabaseConfig(): SupabaseConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch (err) {
    console.error('Failed to parse Supabase config', err);
  }

  return {
    url: '',
    anonKey: '',
    isConnected: false,
    autoSync: false,
  };
}

export function saveStoredSupabaseConfig(config: SupabaseConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch (err) {
    console.error('Failed to save Supabase config', err);
  }
}

let activeClient: SupabaseClient | null = null;

export function getSupabaseClient(config?: SupabaseConfig): SupabaseClient | null {
  const effectiveConfig = config || getStoredSupabaseConfig();
  if (!effectiveConfig.url || !effectiveConfig.anonKey) {
    return null;
  }

  try {
    if (!activeClient) {
      activeClient = createClient(effectiveConfig.url, effectiveConfig.anonKey);
    }
    return activeClient;
  } catch (err) {
    console.error('Error creating Supabase client', err);
    return null;
  }
}

export async function testSupabaseConnection(url: string, anonKey: string): Promise<{ success: boolean; message: string }> {
  if (!url || !anonKey) {
    return { success: false, message: 'Please provide both Supabase URL and Anon Public Key.' };
  }

  try {
    const client = createClient(url, anonKey);
    const { error } = await client.from('emails').select('id').limit(1);

    if (error) {
      if (error.code === '42P01') {
        return {
          success: true,
          message: 'Connected to Supabase! The "emails" table is not created yet. Please copy and run the SQL Schema.',
        };
      }
      return { success: false, message: `Supabase Error: ${error.message} (${error.code || 'unknown'})` };
    }

    return { success: true, message: 'Successfully connected to Supabase and verified database tables!' };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, message: `Connection failed: ${msg}` };
  }
}

export function loadLocalStoredEmails(defaultEmails: EmailMessage[]): EmailMessage[] {
  try {
    const raw = localStorage.getItem(EMAILS_LOCAL_KEY);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch (e) {
    console.error('Error reading emails from localStorage', e);
  }
  return defaultEmails;
}

export function saveLocalStoredEmails(emails: EmailMessage[]): void {
  try {
    localStorage.setItem(EMAILS_LOCAL_KEY, JSON.stringify(emails));
  } catch (e) {
    console.error('Error writing emails to localStorage', e);
  }
}
