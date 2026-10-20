-- =============================================================================
-- GOTHWAD MAIL — Cloudflare D1 schema (`mail` database, binding "DB")
--
-- DO I NEED TO RUN THIS?
--   No. The Worker bootstraps the same statements on its first request
--   (worker/src/db.ts, idempotent CREATE ... IF NOT EXISTS). This file exists
--   for humans who prefer the Cloudflare dashboard: D1 -> `mail` -> Console.
--   `sql/00_d1_console_bootstrap.sql` is the same schema with no comments.
--
-- CLOUDFLARE RULES
--   * Never use PRAGMA here. Remote D1 already enforces foreign_keys = ON and
--     rejects PRAGMA with SQLITE_AUTH.
--   * D1 has no arrays and no JSONB: lists are JSON strings ('[]'), booleans
--     are 0/1, and timestamps are ISO-8601 TEXT.
--
-- WHO WRITES HERE
--   * Worker REST API -> every query is scoped by to_username from the
--     verified Gothwad Accounts session.
--   * Inbound Email Routing handler -> checks the username with Accounts, then
--     inserts into the recipient's mailbox.
--   * Browser -> NEVER touches D1 directly. It calls the Worker API.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Per-user mailbox preferences.
--   retention_limit = 500  -> keep the newest 500 unstarred inbox/sent mails
--   retention_limit = 1500 -> keep the newest 1,500
--   retention_limit = 0    -> "Store All", still capped by quota_bytes
--   quota_bytes = 50 MB of COMPRESSED mail (~25,000 typical messages). This
--   protects the shared free 500 MB D1 database from one flooded account.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mail_settings (
  username        TEXT PRIMARY KEY,
  retention_limit INTEGER NOT NULL DEFAULT 500,
  quota_bytes     INTEGER NOT NULL DEFAULT 52428800,
  updated_at      TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- The mailbox. One row = one message in ONE mailbox.
--   Mailbox owner = to_username (lowercase username, never a full address).
--   Sent mail is stored with to_username = sender and folder = 'sent'.
--   body_gzip holds { "t": plain text, "h": html } gzipped. ~5-8x smaller than
--   raw HTML, which is how hundreds of thousands of mails fit in the free tier.
--   body_text / body_html stay for rows written before compression existed.
--   size_bytes = real stored footprint (compressed body + metadata) so the
--   per-user usage is one cheap SUM().
--   attachments = metadata only [{name,type,size}]. Bytes are never stored.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mail_messages (
  id            TEXT PRIMARY KEY,
  to_username   TEXT NOT NULL,
  from_email    TEXT NOT NULL,
  from_name     TEXT,
  to_email      TEXT,
  cc_emails     TEXT NOT NULL DEFAULT '[]',
  bcc_emails    TEXT NOT NULL DEFAULT '[]',
  subject       TEXT,
  snippet       TEXT,
  body_text     TEXT,
  body_html     TEXT,
  body_gzip     BLOB,
  size_bytes    INTEGER NOT NULL DEFAULT 0,
  attachments   TEXT NOT NULL DEFAULT '[]',
  folder        TEXT NOT NULL DEFAULT 'inbox' CHECK (folder IN ('inbox', 'sent', 'drafts', 'trash')),
  is_read       INTEGER NOT NULL DEFAULT 0 CHECK (is_read IN (0, 1)),
  is_starred    INTEGER NOT NULL DEFAULT 0 CHECK (is_starred IN (0, 1)),
  provider_id   TEXT,
  received_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Fast list: "newest first, one folder, one user". Covers pagination too.
CREATE INDEX IF NOT EXISTS idx_mail_user_folder
  ON mail_messages (to_username, folder, received_at DESC);

-- Starred view + "starred are immune to retention" lookups.
CREATE INDEX IF NOT EXISTS idx_mail_user_starred
  ON mail_messages (to_username, is_starred, received_at DESC) WHERE is_starred = 1;
