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

## Open decisions (ask the user)

1. **Inbound: which addresses are accepted?** Today any local part on `APP_DOMAIN` is stored.
   This is a spam and storage risk. Options:
   - a. Accept only usernames that exist in Accounts. Needs an Accounts lookup endpoint.
     None exists today, and we must not invent one. Would need a change in the Accounts repo, done by its owner.
   - b. Accept only a fixed allow-list, kept in our own table.
   - c. Keep accepting everything for now, and add a per-address rate limit.
2. **Attachments.** Today only name, type and size are kept, and bytes are dropped.
   The owner said tiny files only (under 200 KB total), otherwise skip with a note. Storing
   tiny files needs a storage decision (Supabase Storage on the free tier, or leave it out).

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
