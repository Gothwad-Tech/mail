# PLAN.md — what's built, what's next

## Phase 1 — Real app on the free tier (this branch)

| Area | Status | Notes |
| --- | --- | --- |
| Worker REST API (`/api/*`) | Done, tested | Session, folders, read/star/trash, drafts, send |
| Accounts SSO (cookie) | Done, tested against a stub | `/api/auth/me`; rotated cookies forwarded |
| Accounts SSO (bearer) | Done, tested | `/api/oauth/userinfo`. Not used by the web app yet |
| Send via Resend | Done, not live-tested | Needs Resend key and verified domain |
| Daily send cap | Done | Default 30 (`DAILY_SEND_LIMIT`) |
| Inbound Email handler | Done, tested in workerd | Needs Email Routing (human step) |
| Supabase schema | Done (`supabase/mail.sql`) | Human runs it |
| Frontend (API-backed) | Done | Visual check still needed |
| Auth gate | Done | Signed-out goes to `/signin?choose=1&next=` |
| Docs | Done | README, AGENTS, TASK, PLAN, docs/ |

## Decisions made with the owner

1. **Inbound is accounts-only.** A message is kept only if its name is a row in
   `public.profiles` (Accounts' table, same Supabase project). The Worker reads it with the
   service key. This is not a new Accounts endpoint, and Accounts is not edited.
   - Unknown name → 550 (bounced). Bad name shape → 550, with no database call.
   - Lookup failure → 451 (sender retries). The Worker never guesses that a user exists.
   - Usernames are lowercased in Accounts (signup and its SQL use `LOWER(TRIM(...))`), so the
     exact-match lookup is safe. The Worker lowercases the name too.
2. **Attachments: not now.** Only name, type and size are kept, and bytes are dropped. The
   brief allows tiny files (under 200 KB total). Storing them is a later step (needs a place
   on the free tier, such as Supabase Storage).

## Known gaps (not blocking)

- No Undo for moving to Trash. No "restore from Trash" yet.
- Search filters only the list already loaded in the browser.
- Sidebar folder counts are not shown (there is no cheap server count).
- No polling and no live updates. Refresh is manual.
- The Accounts `ecosystem_apps` row gets `redirect_uris` for `/auth/callback` (see
  `docs/SETUP.md`). The Mail web app has no `/auth/callback` route yet, because the cookie
  SSO flow does not need one. Add it only if an OAuth code flow is built.

## Phase 2 — later (not started)

- Tiny attachment storage (if decided).
- Threading (grouping replies).
- Restore from Trash.
- Server-side search.
