-- =============================================================================
-- GOTHWAD MAIL: database schema
--
-- WHERE TO RUN: Supabase Dashboard > SQL Editor, in a separate project created
-- for Gothwad Mail. Run the whole file once. It is safe to run again.
--
-- WHO TOUCHES THIS TABLE:
--   * Worker REST API (Mail service role key) -> reads/writes rows. Every API
--     query is scoped by to_username from the verified Accounts session.
--   * Inbound email handler -> checks the username with Accounts, then inserts
--     into this Mail project. It does not query the Accounts database.
--   * Browser -> NEVER talks to this table directly. It calls the Worker API.
--
-- Mailbox model: each row belongs to ONE mailbox, identified by to_username
-- (the username part of username@APP_DOMAIN). Sent mail is stored in the
-- sender's mailbox with folder = 'sent'.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.mail_messages (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Reserved and always NULL. Mail usernames do not map to Accounts auth user ids.
  user_id       UUID,
  -- Mailbox owner = username part of username@APP_DOMAIN. Stored lowercase.
  to_username   TEXT NOT NULL CHECK (to_username = lower(to_username) AND length(to_username) BETWEEN 1 AND 64),
  from_email    TEXT NOT NULL,
  from_name     TEXT,
  -- Comma-separated recipients for display, e.g. "a@x.com, b@y.com".
  to_email      TEXT,
  cc_emails     TEXT[] NOT NULL DEFAULT '{}',
  bcc_emails    TEXT[] NOT NULL DEFAULT '{}',
  subject       TEXT,
  -- Short preview for the list view (computed by the Worker, ~160 chars).
  snippet       TEXT,
  body_html     TEXT,
  body_text     TEXT,
  -- Metadata only: [{name, type, size}]. Attachment BYTES are never stored
  -- here, which keeps the free 500 MB database from filling up.
  attachments   JSONB NOT NULL DEFAULT '[]'::jsonb,
  folder        TEXT NOT NULL DEFAULT 'inbox' CHECK (folder IN ('inbox', 'sent', 'drafts', 'trash')),
  is_read       BOOLEAN NOT NULL DEFAULT FALSE,
  is_starred    BOOLEAN NOT NULL DEFAULT FALSE,
  -- Resend message id for outbound, Message-ID header for inbound. Useful for debugging.
  provider_id   TEXT,
  received_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Keep the schema in sync if an older draft of this table already exists.
ALTER TABLE public.mail_messages ADD COLUMN IF NOT EXISTS snippet TEXT;
ALTER TABLE public.mail_messages ADD COLUMN IF NOT EXISTS cc_emails TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE public.mail_messages ADD COLUMN IF NOT EXISTS bcc_emails TEXT[] NOT NULL DEFAULT '{}';

-- Older drafts linked Mail rows to Accounts auth users; this project is separate now.
ALTER TABLE public.mail_messages
  DROP CONSTRAINT IF EXISTS mail_messages_user_id_fkey;

-- Fast mailbox list: "newest first, in one folder, for one user".
CREATE INDEX IF NOT EXISTS mail_messages_user_folder
  ON public.mail_messages (to_username, folder, received_at DESC);

-- Starred view and the daily send-limit count both use these.
CREATE INDEX IF NOT EXISTS mail_messages_user_starred
  ON public.mail_messages (to_username, is_starred) WHERE is_starred;

-- -----------------------------------------------------------------------------
-- Row Level Security
-- RLS on + no policy for anon = anon can read/write NOTHING.
-- The Worker's service role bypasses RLS on purpose (see notes above).
-- -----------------------------------------------------------------------------
ALTER TABLE public.mail_messages ENABLE ROW LEVEL SECURITY;

-- Supabase grants table access to anon by default. Remove it for anon.
-- (authenticated keeps its grant, but RLS + the policy below limit it to
-- rows for its own mailbox; with no policy it can read nothing.)
REVOKE ALL ON public.mail_messages FROM anon;

-- Future-proofing: if a Mail Supabase JWT ever carries a `preferred_username`
-- claim that matches the mailbox, that user may read their own rows directly.
-- Until then this policy matches nothing, which is the safe default.
DROP POLICY IF EXISTS "mail_select_own_mailbox" ON public.mail_messages;
CREATE POLICY "mail_select_own_mailbox"
  ON public.mail_messages
  FOR SELECT
  TO authenticated
  USING (to_username = (auth.jwt() ->> 'preferred_username'));

-- Quick self-check (optional). Should return the column list with no error.
-- SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='mail_messages';
