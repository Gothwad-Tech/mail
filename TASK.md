# TASK.md — session log

Updated every session. Newest first.

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
  - Rotated `gothwad_*` Set-Cookie from Accounts are now passed to the browser.
  - `decodeURIComponent` on bad `%` input now returns 400, not 500.
  - Supabase is accepted at a loopback URL in development only (for local tests).
- Frontend: API-backed `MailContext`, `useSession`, `mailApi`. Sidebar, header, mobile nav,
  account sheet, settings, compose (debounced draft autosave, no attachments), reader
  (sandboxed iframe with CSP, no scripts), list (loading/empty/error, Load more).
- Package renamed to `gothwad-mail`. `.env.example` has `VITE_` placeholders only.
  `OfflineIndicator` text no longer claims cached data.
- Tests: 30 Worker tests (`npm run test:worker`), 2 UI smoke tests (`npm run test:ui`).
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

**Open decisions (ask the user before inbound is final)**
- Inbound accepts mail for ANY local part on `APP_DOMAIN` (spam and storage risk). Checking
  against Accounts needs an endpoint that does not exist yet. Do not invent one.
- Attachment bytes are never stored. Tiny-file storage (under 200 KB) is not built yet.

**Next session**
- Decide the inbound rule above.
- Visual check in a real browser.
- Human runs the SQL and secrets steps in `docs/SETUP.md`, then deploy.
