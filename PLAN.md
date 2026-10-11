# PLAN.md — what's built, what's next

## Phase 1 — Real app on the free tier (this branch)

| Area | Status | Notes |
| --- | --- | --- |
| Worker REST API (`/api/*`) | Done, tested | Session, folders, read/star/trash, drafts, send |
| Accounts SSO (cookie) | Implemented; live handoff needs verification | `/api/auth/me`; rotated cookies forwarded; repeated chooser return was reported, so confirm production shared-cookie settings |
| Accounts SSO (bearer) | Done, tested | `/api/oauth/userinfo`. Not used by the web app yet |
| Send via Resend | Done, not live-tested | Needs Resend key and verified domain |
| Daily send cap | Done | Default 30 (`DAILY_SEND_LIMIT`) |
| Inbound Email handler | Done in code, tested | Depends on Accounts username endpoint and shared secret; keep Email Routing off until verified |
| Supabase schema | Done (`supabase/mail.sql`) | Run only in the separate Mail Supabase project |
| Frontend (API-backed) | Done | Visual check still needed |
| Auth gate | Implemented with return-loop guard | Signed-out goes to `/signin?choose=1&next=`; a returned-but-unverified session shows a diagnostic instead of looping |
| Docs | Done | README, AGENTS, TASK, PLAN, docs/ |

## Decisions made with the owner

1. **Mail has its own Supabase project.** Mail never reads Accounts' `public.profiles`, and
   it does not share Accounts' database key. `user_id` remains null; mailbox ownership is the
   normalized `to_username`.
2. **Inbound is accounts-only, through Accounts' internal API.** The Worker sends the
   lowercased local part to `GET {AUTH_HUB_URL}/api/internal/usernames/:username` with
   `Authorization: Bearer <ACCOUNTS_INTERNAL_TOKEN>` (the same value as Accounts'
   `MAIL_INTERNAL_TOKEN`). Only an explicit `200 {"exists": true}` permits storage; `false`
   gets 550, while missing secrets, network/timeout errors, non-200 responses, and bad JSON
   get 451. Bad name shape gets 550 without a network call.
   - The Accounts `main` docs did not yet document this endpoint when this Mail integration
     was prepared. This code follows the owner's supplied contract; do not enable Email
     Routing until Accounts documents/deploys the matching endpoint and the human confirms it.
   - Unknown names are never guessed to exist. The Accounts database is not queried.
3. **Attachments: not now.** Only name, type and size are kept, and bytes are dropped. The
   brief allows tiny files (under 200 KB total). Storing them is a later step (needs a place
   on the free tier, such as Supabase Storage).

## Known gaps (not blocking)

- **Live Accounts SSO still needs verification.** A user reported that account selection returns
  to the chooser. Mail now detects that failed handoff and stops the loop; check the deployed
  Accounts cookie Domain and `GET /api/session` status as described in `docs/MAIL.md`.
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
