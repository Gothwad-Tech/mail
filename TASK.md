# TASK.md — session log

Updated every session. Newest first.

## 2026-10-11 — Worker config stops losing values: keep_vars, real SUPABASE_URL, guard test

**Report from the owner:** Supabase-related values and secrets seem to be gone at the next
build, and the TOML was supposed to be updated when they were added, but never was.

**Root cause (Cloudflare behaviour, not a bug in this repo):** the Worker is deployed from the
dashboard/Git path, which treats the committed config as the source of truth. Plain-text
dashboard variables are replaced or deleted by every deploy; encrypted **Secrets** are never
deleted. On top of that, `SUPABASE_URL` in `wrangler.toml` was still
`https://YOUR_PROJECT_REF.supabase.co`, so `isSupabaseConfigured()` was false and the Worker
refused every Supabase call (`not_configured` / `supabase_not_configured`) even when the
service key was set.

**Done**
- `worker/wrangler.toml`: `keep_vars = true`; `SUPABASE_URL` set to the owner-supplied Mail
  project URL `https://womkqxzbiwgfudxbwkau.supabase.co` (public, not a secret); header
  rewritten around the source-of-truth rule, the three secret names, and how to list secret
  **names** on the deployed Worker.
- `package.json`: `npm run worker:secrets` (sets all three; Wrangler prompts for each value) and
  `npm run worker:secrets:list` (names only).
- `worker/src/config.ts`: new `configStatus(env, config)` returning booleans only.
  `GET /api/health` now answers
  `configured: { supabaseUrl, supabaseServiceKey, accountsInternalToken, resendApiKey }`, so a
  deploy that wiped something is visible in one curl. Never a key, never a URL.
- New `tests/worker-config.test.ts` + `npm run test:config` (also part of `npm test`): fails if
  `keep_vars` is missing, a required var is blank, `SUPABASE_URL` is a placeholder, a secret
  name is declared in the file, or a secret-shaped value (`sb_secret_`, `re_`, `eyJ...`,
  `service_role`) is committed.
- Docs: `docs/SETUP.md` (where each value lives + survives-a-deploy table, secrets via dashboard
  type **Secret** or CLI, `/api/health` check, updated checklist), `README.md`,
  `docs/MAIL.md` (health row), `AGENTS.md` (rules + known traps), `PLAN.md`.

**Verified in this sandbox**
- `npm run lint` — pass. `npm run test:config` — 8 pass. `npm run test:auth` — 5 pass.
  `npm run test:worker` — **56 pass** (was 55; new `configured` booleans test, plus a check
  that health never echoes a URL).
- `npx wrangler deploy --dry-run --config worker/wrangler.toml` — bundles clean and lists all
  nine vars, including the real `SUPABASE_URL`.
- Real `wrangler dev` (workerd, port 8787): `GET /api/health` returned
  `configured: {all four true}` with a temporary `worker/.dev.vars`; the file was deleted
  afterwards.
- `npm run test:ui` — not run (needs the seeded mailbox and a real Accounts session, as before).

**Human steps still needed**
1. Dashboard → Workers & Pages → `gothwad-mail-api` → Settings → Variables and Secrets →
   **Production** → add the three secrets as type **Secret**: `SUPABASE_SERVICE_ROLE_KEY`
   (Mail project's `sb_secret_...`), `RESEND_API_KEY` (`re_...`), `ACCOUNTS_INTERNAL_TOKEN`
   (same value as Accounts' `MAIL_INTERNAL_TOKEN`). Values stay out of chat and out of git.
2. Deploy the Worker (`npm run worker:deploy`); `npm run worker:secrets:list` must list those
   three names.
3. `curl -s https://mail.gothwadtech.com/api/health` → `configured` has four `true` values.
4. Confirm `https://womkqxzbiwgfudxbwkau.supabase.co` is the **Mail** project and that
   `supabase/mail.sql` was run there.

---

## 2026-10-11 — Split the two Accounts URLs: server-side vs browser-facing

**Goal:** Mail's server-to-server call to `https://accounts.gothwadtech.com/api/auth/me`
cannot work: Cloudflare does not invoke a same-zone Worker that is attached by a Route, so the
request was served by the Pages SPA and answered `200 text/html`. Mail reported that correctly
as 503 `accounts_unexpected_response`. Accounts now also answers on the Custom Domain
`api.gothwadtech.com`, which does reach the Worker.

**Done**
- `worker/src/config.ts`: new optional `AUTH_SIGNIN_URL`, resolved as `authSigninUrl` with a
  fallback to the resolved `AUTH_HUB_URL` (a blank value falls back too). `AUTH_HUB_URL` stays
  the base for **every** server-side fetch: `/api/auth/me`, `/api/oauth/userinfo` and
  `/api/internal/usernames/:username` (inbound).
- `AUTH_SIGNIN_URL` is used **only** for browser-facing URLs: `signinBaseUrl()` in
  `worker/src/session.ts` (the 401 `signinUrl`) and `accountUrl` in `worker/src/index.ts`.
- `worker/wrangler.toml` `[vars]`: `AUTH_HUB_URL = "https://api.gothwadtech.com"`,
  `AUTH_SIGNIN_URL = "https://accounts.gothwadtech.com"`. Documented in `.env.example`,
  `docs/MAIL.md` (new "The two Accounts URLs" section) and `docs/SETUP.md` (values table,
  deploy step, checklist).
- The 503 `accounts_unexpected_response` body now carries `upstreamStatus` and
  `upstreamContentType`, so DevTools shows "Accounts answered 200 text/html" without opening
  the Worker log. Status and content-type only — no upstream body, no cookie or token value.
  The `accounts_check_failed ...` log line is unchanged.
- **Not done on purpose:** the `[[services]]` service-binding option. The owner chose the
  Custom Domain route, so no `ACCOUNTS` binding was added and `session.ts` / `inbound.ts`
  still use plain `fetch`. If the binding is wanted later, add it alongside
  `AUTH_HUB_URL` and keep plain `fetch` as the fallback.

**Verified in this sandbox**
- `npm run lint` — pass (root + `worker/tsconfig.json`).
- `npm run test:worker` — **55 pass** (was 48). New: 200 `text/html` → 503 with
  `upstreamStatus`/`upstreamContentType` (cookie path, bearer path and 302); a check that the
  body carries no upstream body or cookie value; sign-in links use `AUTH_SIGNIN_URL` while
  `/api/auth/me`, `/api/oauth/userinfo` and the inbound username lookup use `AUTH_HUB_URL`;
  blank/missing `AUTH_SIGNIN_URL` falls back.
- Mutation-checked: reverting `signinBaseUrl` to `authHubUrl` and deleting the
  `upstreamStatus`/`upstreamContentType` fields fails 6 tests; reverting `accountUrl` fails 1.
- `npm run test:auth` — 5 pass. `npm run build` — pass.
- `npx wrangler deploy --dry-run` — bundles cleanly and lists both bindings:
  `env.AUTH_HUB_URL ("https://api.gothwadtech.com")`,
  `env.AUTH_SIGNIN_URL ("https://accounts.gothwadtech.com")`.
- Real `wrangler dev` (workerd, port 8787): `GET /api/session` with no cookie returned
  `401 {"error":"unauthenticated", "signinUrl":"https://accounts.gothwadtech.com/signin?choose=1"}`
  — the sign-in host, not the API host. With a cookie it tried the Custom Domain and, having
  no outbound route from the sandbox, returned 503 `auth_unavailable` with the log line
  `accounts_check_failed code=auth_unavailable status=none content-type=none`.
- `npm run test:ui` — **could not run here**: it needs a seeded Mail Supabase mailbox
  ("Invoice for October") and a real Accounts session. Confirmed environmental, not a
  regression: the same 4 failures with the same "Timed out waiting for" errors happen on the
  unmodified baseline (verified with `git stash`). No `worker/.dev.vars` or stub was left
  behind; nothing extra is committed.

**Human step still needed**
- Set the same two vars on the **deployed** Worker: dashboard → Workers & Pages →
  `gothwad-mail-api` → Settings → Variables and Secrets → **Production** →
  `AUTH_HUB_URL = https://api.gothwadtech.com`,
  `AUTH_SIGNIN_URL = https://accounts.gothwadtech.com` (plain Text, not secret), then
  redeploy so the dashboard and `wrangler.toml` agree. A stale dashboard value overrides the
  file.
- Then re-check `https://api.gothwadtech.com/api/auth/me` (status + JSON only) and reload
  `https://mail.gothwadtech.com`.

---

## 2026-10-11 — Stop calling every Accounts problem "signed out"

**Goal:** Fix "Accounts sent you back to Mail, but Mail could not verify your sign-in".
Evidence from a real failing browser: the `gothwad_at` cookie IS sent to
`mail.gothwadtech.com/api/session`, the JWT is fresh, and the 401 body is Mail's own
`requireSession` body with no `Set-Cookie`. So the cookie handoff worked and the failure was
in Mail's verification call to Accounts — which Mail collapsed into "signed out" (and from
there into an endless chooser).

**Done**
- `worker/src/session.ts`: a 401 from Mail now means **only** "Accounts answered 401/403".
  Everything else Mail cannot read is a 503 with its own code:
  - `accounts_user_invalid` — Accounts said `authenticated: true` but `user.username` is
    missing or fails `normalizeUsername` (was a 401).
  - `accounts_unexpected_response` — a 3xx from Accounts (never followed), or a 200 that is
    not Mail's JSON / has no `authenticated` flag, e.g. HTML from a misrouted `/api/*`
    (was a 401).
  - `auth_unavailable` — network error, timeout, 5xx (unchanged).
- One `console.warn` line per failure: code + upstream status + upstream content-type
  (`accounts_check_failed ...`). Cookie values, tokens and response bodies are never logged.
- `redirect: 'manual'` and the `keepAccountsCookies` / `takeUpstreamCookies` handling are
  untouched.
- Frontend: `classifySessionFailure` in `src/hooks/useSession.ts` only redirects for a **401
  with a signinUrl**; every 503 shows the error screen with Retry. The
  `accounts_user_invalid` / `accounts_unexpected_response` message now says the account is
  signed in but Mail could not load the profile (no "cookie may be expired" talk). The
  `__mail_auth_return` loop guard is unchanged.
- Tests: 10 new/updated Worker tests (full status table, never-follow-redirect, log line
  without secrets), 3 new frontend tests in `tests/auth-redirect.test.ts`, and 1 new jsdom
  smoke test for the 503 screen (skips itself if the local Accounts stub lacks the fixture).
- Docs: `docs/MAIL.md` now has the `/api/session` status table and rewritten chooser
  troubleshooting; `docs/SETUP.md` got the same codes plus the `test:ui` stub expectations.

**Verified in this sandbox**
- `npm run lint` — pass. `npm run build` — pass (usual Vite `configLoader: 'native'` warning).
- `npm run test:worker` — 48 tests pass. `npm run test:auth` — 5 tests pass.
- Real `wrangler dev` (workerd) with temporary local Accounts/Supabase stubs: `/api/session`
  returned 200 / 401 / 503 `accounts_user_invalid` / 503 `accounts_unexpected_response`
  (HTML and 302) / 503 `auth_unavailable` exactly as the table says, and the Worker log
  showed one `accounts_check_failed` line per failure with no cookie or body content.
- `npm run test:ui` — 4 tests pass (including the new 503 screen). Stubs and `worker/.dev.vars`
  were removed afterwards; nothing extra is committed.

**Human verification still needed (production)**
1. Same browser profile: open `https://accounts.gothwadtech.com/api/auth/me` and check only
   the status, that it is JSON, and `authenticated` / `user.username`. Do not share the body.
2. Reload `https://mail.gothwadtech.com` — the inbox should load. If not, the `/api/session`
   status and `error` code name the failing branch (see the table in `docs/MAIL.md`).
3. Never paste cookie values, JWTs or refresh tokens into a PR, an issue or chat.

---

## 2026-10-11 — Diagnose the Accounts chooser return loop

**Goal:** Investigate the report that selecting an already-signed-in Gothwad account returns
to the Accounts chooser instead of opening Mail.

**Finding**
- The reported `next=https://mail.gothwadtech.com/` destination is correctly encoded. The
  Accounts chooser's return path accepts Gothwad subdomains in the read-only Accounts `main`
  source. The loop therefore most likely happens after the redirect: Mail's
  `GET /api/session` still sees the Accounts session as missing/invalid (401).
- The current Accounts source is designed to set `gothwad_at` and `gothwad_rt` on
  `Domain=.APP_DOMAIN`, shared across Gothwad subdomains. The live cookie attributes and
  deployed Accounts Worker could not be verified from this checkout, so the production cause
  still needs a browser check.

**Done**
- Mail adds a one-time return marker to `next`. If the browser comes back but `/api/session`
  is still 401, Mail now shows an actionable error rather than bouncing to the chooser forever.
- Added URL helper tests and a UI smoke test for both the initial redirect and failed return.
- Updated `docs/MAIL.md`, `docs/SETUP.md`, `PLAN.md`, `README.md`, and `AGENTS.md` with the
  diagnosis, cookie checks, and new test command.

**Human verification still needed**
- In the same browser profile, check the Mail `/api/session` status after choosing an account.
  A 401 means the session cookie was not verified; check only the `gothwad_at`/`gothwad_rt`
  cookie names and Domain/Path/Secure attributes, never share their values.
- Confirm the deployed Accounts Worker sets the cookies on `.APP_DOMAIN` and is current.
  Mail's redirect URL itself does not need changing.

**Verified**
- `npm run lint` — pass.
- `npm run build` — pass (existing Vite `configLoader: 'native'` compatibility warning).
- `npm run test:auth` — 2 tests pass.
- `npm run test:worker` — 38 tests pass.
- `npm run test:ui` — 3 tests pass against temporary local Accounts/Supabase stubs; stubs and
  `worker/.dev.vars` were removed. Wrangler emitted its usual optional `Request.cf` warning.

---

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
