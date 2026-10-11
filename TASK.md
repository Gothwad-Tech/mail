# TASK.md — session log

Updated every session. Newest first.

## 2026-10-11 — Separate Mail storage and Accounts API inbound check

**Goal:** Replace the old shared-Supabase `profiles` lookup with a fail-closed Accounts
endpoint check. The Mail project is now separate from Accounts.

**Done this session**
- Mail inbound sends the normalized local part to
  `GET {AUTH_HUB_URL}/api/internal/usernames/:username` with the secret bearer token.
  Unknown users get 550; missing token, network/timeout errors, non-200 responses and bad
  JSON get 451. Domain, size and username-shape checks happen before the lookup.
- The Worker no longer reads Accounts' `public.profiles`. It creates the Mail `Db` only
  after Accounts confirms the username, and stores `user_id` as null.
- Added `ACCOUNTS_INTERNAL_TOKEN` secret typing/config, a local placeholder, timeout,
  manual redirects, and inbound tests for success, unknown, 401, network/timeout, bad JSON,
  invalid shape, missing token and header-only token transfer.
- `supabase/mail.sql` has no `auth.users` foreign key and drops the old default FK name on
  rerun. Setup and design docs now require a separate Mail Supabase project.
- The Accounts repo's `main` documentation did not yet describe the supplied endpoint
  contract. This integration follows the owner's exact contract; Email Routing must remain
  off until Accounts documents/deploys it and the human confirms the response.
- Updated `AGENTS.md`, `PLAN.md`, `README.md`, `docs/MAIL.md` and `docs/SETUP.md`.

**Human steps still needed**
- Create the separate Mail Supabase project, run `supabase/mail.sql`, set its real URL/key.
- Set `ACCOUNTS_INTERNAL_TOKEN` in Mail and `MAIL_INTERNAL_TOKEN` in Accounts to the same
  secret; deploy Worker, then Pages.
- Confirm the Accounts endpoint with a curl check before enabling Email Routing.

**Verified in this session**
- `npm run lint` — pass.
- `npm run build` — pass (Vite printed the existing `configLoader: 'native'` compatibility warning).
- `npm run test:worker` — 38 tests pass.
- `npx wrangler deploy --dry-run --config worker/wrangler.toml` — pass; the Accounts token is not a Wrangler var.
- `npm run test:ui` — 2 smoke tests pass against temporary local Accounts/Supabase stubs.
  `worker/.dev.vars` and the temporary stub were removed afterward. Wrangler warned that it
  could not fetch optional `Request.cf` metadata in this sandbox; the local Worker still ran.

## 2026-10-10 — Turn the webmail UI into a real app

**Goal:** Gothwad Mail is a real webmail (no demo data). Sign-in is Gothwad Accounts SSO.
Backend is a Cloudflare Worker REST API plus an Email Worker for inbound mail, on Supabase
(the same project as Accounts), with Resend for outbound. Mail address is
`username@APP_DOMAIN`. Keep the visual design.

**Acceptance:**
- [x] No demo data in the production build (`src/data/mockEmails.ts` removed).
- [x] No fake names (the old "John Demo"/"Pawan Gothwad" text is gone).
- [x] Gothwad email shown from the session (`GET /api/session`).
- [x] Loading, empty and error states in the list, the reader and the session gate.
- [x] Auth gate on private routes (`AuthGate` in `src/App.tsx`; signed-out users go to Accounts with `next=`).
- [x] Folders: Inbox, Sent, Drafts, Trash, Starred.

**Done this session**
- Worker: REST API, scoped queries (`to_username`), Accounts session, send via Resend
  with a daily cap, inbound Email handler, CSRF guard, size caps.
- Worker fixes found by testing against a realistic Accounts stub:
  - Inbound now checks `profiles.username` before storing mail (accounts-only).
  - Rotated `gothwad_*` Set-Cookie from Accounts are now passed to the browser.
  - `decodeURIComponent` on bad `%` input now returns 400, not 500.
  - Supabase is accepted at a loopback URL in development only (for local tests).
- Frontend: API-backed `MailContext`, `useSession`, `mailApi`. Sidebar, header, mobile nav,
  account sheet, settings, compose (debounced draft autosave, no attachments), reader
  (sandboxed iframe with CSP, no scripts), list (loading/empty/error, Load more).
- Package renamed to `gothwad-mail`. `.env.example` has `VITE_` placeholders only.
  `OfflineIndicator` text no longer claims cached data.
- Tests: 33 Worker tests (`npm run test:worker`), 2 UI smoke tests (`npm run test:ui`).
- Docs: `README.md`, `AGENTS.md`, `PLAN.md`, `docs/SETUP.md`, `docs/MAIL.md`.

**Verified in this sandbox**
- Real `wrangler dev` (workerd runtime) with local stubs for Accounts and Supabase:
  signed-out 401 with sign-in URL, session, folder lists, per-user scoping (other user's
  message is 404), CSRF origin check, Supabase key only in `apikey`, send fails cleanly
  with 502 when Resend is unreachable, inbound email stored, wrong-domain rejected (550),
  bad `%` id returns 400.
- Vite dev proxy `/api` reaches the Worker.
- jsdom UI smoke test renders the real `<App />`: session gate, inbox, opening a message
  (sandboxed iframe), compose, and the signed-out redirect state. No React console errors.

**Not verified**
- No real browser here (no Chromium, and the Playwright browser download is blocked). Visual
  check is still needed in a real browser.
- Real Resend sending, real Supabase, real Email Routing, production deploy. These need the
  human steps in `docs/SETUP.md`.

**Decisions made with the owner**
- Inbound is **accounts-only**. Mail is kept only if the name is in `public.profiles`
  (the Accounts table, same Supabase project). That is a read of the shared DB, not a new
  Accounts endpoint. Unknown names get 550. A failed lookup gets 451 (retry), never a guess.
- Attachments: **not now**. Only name, type and size are kept, and the bytes are dropped.
  Tiny-file storage (under 200 KB) can come later.

**Next session**
- Visual check in a real browser.
- Confirm the 451 "retry later" reply works with Cloudflare Email Routing (not testable here).
- Human runs the SQL and secrets steps in `docs/SETUP.md`, then deploy.
