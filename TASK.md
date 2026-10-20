# TASK.md — session log

Updated every session. Newest first.

## 2026-10-20 — Multi-account switcher: plan + Accounts-side prompt (docs only, no code)

**Owner request:** Google jaisa account section — ek hi jagah saare signed-in Gothwad accounts,
avatar + unread, tap karke us mailbox par ~1 second me switch. Abhi sirf ek email dikhti hai
jabki `accounts.gothwadtech.com` par 2 logins hain.

**Finding:** ye Mail me akela fix nahi ho sakta. `worker/src/session.ts` har request par Accounts
se **ek** identity leta hai, aur Accounts ek hi session per browser rakhta hai. Mail ko apni
account list rakhne par majboor karna = doosre accounts ke credentials Mail me rakhna, jo
allowed nahi. Data migration bhi nahi chahiye: har row pehle se `username` se scoped hai.

**Deliverables (docs only this session):**

- `docs/ACCOUNTS_AGENT_PROMPT.md` — self-contained prompt for the Accounts agent: per-account
  session cookies (`gothwad_sess_a..f`), HMAC-signed `gothwad_accounts` list, `gothwad_active`,
  and four endpoints (`GET /api/auth/accounts`, `POST /api/auth/switch`,
  `POST /api/auth/accounts/:id/signout`, `GET /signin?choose=1&add=1`). Includes the cookie
  constraints Mail's proxy depends on, 8 required tests, and legacy single-account fallback so
  nothing breaks.
- `docs/MULTI_ACCOUNT_PLAN.md` — Google-parity behaviour table, Mail-side work (proxy endpoints
  in a new `worker/src/accounts.ts`, session plumbing + cache reset, switcher UI in
  `AccountSheet`, instant switch), security checklist, 12 acceptance tests, $0 cost, rollback.

**Key design decisions:**

- **Server-side path resolution, not a client header.** The active account is a cookie resolved
  by Accounts, so `GET /api/auth/me` keeps returning one identity and `session.ts` needs no change.
- **Mail proxies Accounts, no CORS.** Reuses `takeUpstreamCookies` so `Set-Cookie` rotation is
  forwarded exactly as it is today.
- **404 fallback = hidden switcher.** Mail can ship first and light up when Accounts deploys.
- **Caches cleared before first paint on switch** (privacy, not just freshness).
- Unread per account is computed in Mail's D1 for Accounts-verified usernames only.

**Blocked on:** Accounts repo (Part A). Mail-side Part B starts when that contract exists.

---

## 2026-10-20 — Fast, mobile-first UI + PWA polish (layout, caching, ETag)

**Owner request:** make the webmail feel right on mobile and desktop, keep the UI simple, make
it lightweight/fast with caching so Cloudflare does not redo work for already-seen mail, and
make PWA support solid.

**Backend (why: less work for repeated reads)**

- `GET /api/mail/messages/:id` now sends an **ETag** built from cheap columns only
  (`id`, `is_read`, `is_starred`, `size_bytes`, `received_at`) and answers **304** when the
  client's `If-None-Match` matches. The gzip decompression is skipped entirely on a 304.
  `Cache-Control: private, no-cache` keeps it per-user and always revalidated.
- `DETAIL_COLUMNS` now includes `size_bytes` (the tag was otherwise built from `undefined`).
- New helpers in `worker/src/mail.ts`: `getMessageRow`, `messageEtag`, `etagMatches`.
- Test: revalidation returns 304 with an empty body; a PATCH invalidates the tag.

**Frontend (why: instant, native feel)**

- `MailContext`: per-folder memory cache (paint cached list, revalidate in the background with
  a thin progress strip; a failed refresh keeps the cached list), detail cache,
  `prefetchEmail()` on hover/touch/focus, `isRefreshing`, `unreadInboxCount`.
- `App.tsx`: `100dvh` shell with flex `min-h-0` (no `calc(100vh-...)`), lazy-loaded
  `ComposeModal`/`SettingsModal` (separate ~8 KB chunks), unread count in the tab title,
  `${'/'}` focuses search, deep links `/?folder=` and `/?compose=1` for PWA shortcuts.
- `EmailList`: skeleton rows instead of a spinner, unread dot, 60px tap targets, keyboard
  open on Enter, `overscroll-contain`, revalidation strip.
- `EmailDetail`: message iframe fills the available height (no nested scroll), skeleton body,
  attachments in a bordered footer, bottom safe-area padding.
- `MobileBottomNav`: 5 folders + unread badge + active indicator, round compose FAB,
  `env(safe-area-inset-bottom)` padding. `Sidebar`/`MobileDrawer`: unread badge, collapse width.
- `index.css`: `prefers-reduced-motion` support, 16px inputs on mobile (no iOS zoom),
  `overscroll-behavior`, height roots.
- `index.html`: non-blocking Google Fonts (system font first, swap when ready).
- `manifest.json`: `display_override`, orientation, categories, 3 shortcuts, `id`.
  `vite.config.ts`: Workbox `navigateFallback`, **`/api/*` excluded from the SW cache**,
  font + image runtime caching, `skipWaiting`/`clientsClaim`.

**Verified**

- `npm run lint` pass. `npm test` → **93 pass** (config 10, auth 5, worker 58, d1 15, ui 5).
- `npm run build` → main `index` 295.34 kB (87.95 kB gzip) + `ComposeModal` 8.74 kB +
  `SettingsModal` 8.28 kB lazy chunks; SW precache 31 entries.
- Live preview: `If-None-Match` on a message returned **304 with 0 bytes**; folder switching
  and the Settings retention toggle still work.

---

## 2026-10-20 — Clarify the Builds settings: keep Root directory `/`, set the Preview command

**Report:** while fixing the red PR check, the owner changed the **Production** Root directory
from `/` to `worker`. The dashboard's Previews tab does have a **Preview command** field, so no
file move is needed.

**Correction captured in `docs/SETUP.md`:**

- Root directory stays **`/`** for Production **and** Previews. `package.json`, `node_modules`
  and `worker/` all live at the root, and `--config worker/wrangler.toml` is relative to it.
  Root = `worker` would break production twice: `npm ci` finds no `package.json`, and the
  config path would resolve to `worker/worker/wrangler.toml`.
- Production: Build command `npm ci`, Deploy command `npm run worker:deploy`.
- Previews: Build command `npm ci`, **Preview command**
  `npx wrangler preview --config worker/wrangler.toml`.
- Then retry the failed build. The `previews = {}` block in `worker/wrangler.toml` is what
  `wrangler preview` needs once it can see the config.

No application code changed in this entry.

---

## 2026-10-20 — Fix red "Workers Builds: mail" check (missing `previews` block)

**Root cause:** Workers Builds runs `npx wrangler deploy` on `main`, but
`npx wrangler preview` on non-production branches. Since Worker Previews shipped,
`wrangler preview` refuses to start without a `previews` block, so every PR build failed
before compiling anything (the same check was already red on PR #7, which still merged).

**Done (merged in PR #8):** `previews = {}` in `worker/wrangler.toml`, kept empty on purpose so
a Preview has no D1 binding and no secrets and can never touch production mail. Guarded by
`tests/worker-config.test.ts`; documented in `AGENTS.md` and `docs/SETUP.md`.

**Verified:** `npx wrangler preview --config worker/wrangler.toml` gets past the config check
and stops only at the expected local-only `CLOUDFLARE_API_TOKEN` error, which Workers Builds
provides.

---

## 2026-10-20 — 100% Cloudflare D1 migration + smart retention & gzip (Supabase removed)

**Owner request:** remove every Supabase dependency from Mail and move it to 100% native
Cloudflare Workers + D1 (`mail` database), with gzip-compressed bodies and a per-user retention
choice (Latest 500 / Latest 1,500 / Store All) in Settings, while starred mail and drafts are
never auto-deleted. Owner supplied the `mail` D1 id: `87854cea-7feb-46f3-ab99-2a2137f31105`.

**Done — storage**

- `worker/wrangler.toml`: added `[[d1_databases]] binding = "DB"`, `database_name = "mail"`,
  real `database_id`; removed `SUPABASE_URL`; header rewritten for the two remaining secrets
  (`ACCOUNTS_INTERNAL_TOKEN`, `RESEND_API_KEY`). Worker name stays `mail`.
- `worker/src/db.ts`: rewritten. D1 wrapper + idempotent schema bootstrap in one `batch()`,
  cached per D1 instance with `WeakMap<object, Promise<void>>`, so an empty database works on
  the very first request (including `GET /api/health`). No PRAGMA anywhere.
- Gzip helpers (`CompressionStream`/`DecompressionStream`): bodies stored as one `body_gzip`
  BLOB containing `{t,h}` JSON; `readBodies()` still reads legacy `body_text`/`body_html`.
  `storedSize()` computes the real footprint; text capped at 100k chars, HTML at 250k.
- `sql/01_mail_schema.sql` (documented) and `sql/00_d1_console_bootstrap.sql` (comment-free).
  Deleted `supabase/mail.sql` and the `supabase/` directory.
- `worker/src/config.ts`: `Env.DB`, no Supabase fields; `configStatus()` now returns
  `{ d1Binding, accountsInternalToken, resendApiKey }`.
- `worker/src/mail.ts`: every query rewritten as scoped SQL (list/get/patch/delete/drafts/
  count). `insertMessage()` is shared by inbound and send. `size_bytes` set on every write.

**Done — retention (`worker/src/retention.ts`)**

- `mail_settings` (`retention_limit` 500|1500|0, `quota_bytes` 50 MB, `updated_at`) and stats.
- Rule A: Trash older than 30 days is purged.
- Rule B: starred rows and drafts are excluded from EVERY automatic delete.
- Rule C: count cap keeps the newest N unstarred inbox/sent messages (one indexed DELETE).
- Rule D: Store All keeps everything under quota; over quota it deletes the oldest unstarred
  trash first, then the oldest unstarred mail, in bounded rounds.
- Runs after inbound mail, after a send, and immediately on `PATCH /api/mail/settings`.

**Done — API + UI**

- `GET /api/mail/settings` and `PATCH /api/mail/settings` (CSRF via `assertSafeWrite`).
- `/api/health` now returns `engine: "cloudflare-d1-native"` and a live
  `database: { bound, ready, tables }` from `sqlite_master`; zero Supabase fields.
- `src/services/mailApi.ts`: `getSettings()`, `updateSettings(limit)` + types.
- `src/context/MailContext.tsx`: loads usage when Settings opens, refreshes the list after a
  retention change and toasts the cleanup counts.
- `src/components/SettingsModal.tsx`: “Mailbox Storage & Email Retention” card with a live
  progress bar (`Used X of 50 MB · N emails · K starred`), three radio options and the badge
  “⭐ Starred emails & Drafts are never auto-deleted. Trash empties after 30 days.”

**Done — local testing/preview**

- `tools/local-d1.mjs`: real D1-shaped adapter over Node 22 `node:sqlite` (`DatabaseSync`),
  zero NPM packages. No database mock anywhere in the tests.
- `tools/dev-server.mjs` + `npm run preview:api`: runs the real Worker on local SQLite, seeds a
  small mailbox for `pawan` (browser preview via `DEV_AUTH_USERNAME`) and `alice` (UI smoke
  test cookie), fakes Resend and the Accounts cookie endpoints. Vite proxies `/api` to it.
- Tests: **91 passing** — `test:config` 9, `test:auth` 5, `test:worker` 57, `test:d1` 15,
  `test:ui` 5 (new Settings card test included). Tests cover auto-bootstrap, gzip round-trip
  with Hindi/emojis/large HTML, 500-cap trimming, starred/draft immunity, 30-day trash purge,
  Store All quota trimming (trash first), settings endpoints, full CRUD, inbound token/451/550
  paths, CSRF/CORS and cookie rotation.
- `package.json`: removed `@supabase/supabase-js`, `@google/genai`, `express`, `dotenv`,
  `@types/express`, `motion` (all unused); `worker:secrets` now sets only the two secrets;
  added `test:d1` and `preview:api`. `npm test` includes `test:d1`.
- `tsconfig.json`: excludes `tests/local-d1.test.ts` and `tools/dev-server.mjs` because they
  pull in Worker code with Workers types (the Worker tsconfig checks that code).
- `.env.example`, `worker/.dev.vars.example`, `.gitignore` (local sqlite files) updated.

**Verified in this sandbox**

- `npm run lint` — pass. `npm test` — 91 pass. `npm run build` — pass
  (`dist/assets/index-*.js` 306.61 kB / 89.21 kB gzip).
- `npx wrangler deploy --config worker/wrangler.toml --dry-run` — bundles clean (154.13 KiB /
  38.27 KiB gzip) and lists `env.DB (mail)` plus the eight public vars, no Supabase var.
- Live preview: `npm run preview:api` + `npm run dev`. `/api/health` → ready:true, tables:2.
  `PATCH /api/mail/settings` from a preview origin returned `cleanup: { trashPurged: 1 }`
  (the seeded 45-day-old Trash mail), proving retention + CSRF + SQLite in one call.

**Human steps still needed (owner)** — full detail in `docs/SETUP.md`

1. Dashboard → Workers & Pages → `mail` → Settings → Variables and Secrets → Production:
   confirm only `ACCOUNTS_INTERNAL_TOKEN` and `RESEND_API_KEY` exist; delete any leftover
   `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_URL`. Run `npm run worker:secrets:list` to check
   names only.
2. `npm run worker:deploy`, then `curl -s https://mail.gothwadtech.com/api/health` and confirm
   `database.ready: true` and all three `configured` booleans `true`.
3. Keep the route `mail.gothwadtech.com/api/*` → Worker `mail` and the Email Routing catch-all
   `*@gothwadtech.com` → Worker `mail`.
4. After the D1 version is verified, delete the old Mail Supabase project (export any old mail
   first). Never delete the Accounts project.
5. Test in the browser: open Settings → switch retention to 1,500 → the progress bar and
   counts update; star a mail and confirm it survives a retention change.

---

## 2026-10-11 — Worker name fix: repo config now says `mail` (matches the dashboard)

**Report from the owner:** the repo said the Worker was `gothwad-mail-api`, but the Cloudflare
Worker is `mail`. Local CLI commands (`npm run worker:secrets:list`, `npm run worker:deploy`)
pointed at the wrong Worker, so the secrets looked "missing" even though they were set.

**Root cause:** `worker/wrangler.toml` had `name = "gothwad-mail-api"`. Deploys from the
dashboard/Git path (**Workers Builds**) go to the dashboard's Worker and override the config
name with `WRANGLER_CI_OVERRIDE_NAME` (Wrangler v3+), so Git deploys hit `mail` and the mismatch
stayed hidden. Local Wrangler commands read `name` from the file, so they hit a Worker called
`gothwad-mail-api` that does not exist — or, worse, would have created one.

**Done**
- `worker/wrangler.toml`: `name = "mail"`. Nothing else changed — `keep_vars = true`, all nine
  `[vars]` (including the real `SUPABASE_URL`) and the header are as they were; one comment was
  added above `name` explaining why it must match the dashboard and must not be renamed.
- `docs/SETUP.md`: every Worker-name reference updated to `mail` — dashboard secrets path
  (Workers & Pages → `mail` → Settings → Variables and Secrets → Production), dashboard
  variables path, route step (Domains & Routes), Email Routing catch-all picker, and the
  checklist line. Added a short "Worker name: `mail` (do not rename it)" section explaining the
  Workers Builds override and the local-CLI mismatch.
- `README.md`: Deploy section now states the Worker is `mail` and the config must stay equal.
- `AGENTS.md`: new "known things not to retry" entry — do not rename the Worker in
  `wrangler.toml`; fix the file, never the dashboard (the `mail` Worker holds the secrets, the
  route and the catch-all).
- `/api/health`'s `service` field is a cosmetic label, **not** the Worker name, so it was left
  as `"gothwad-mail-api"` and the README/SETUP JSON examples were left unchanged (one line was
  added in SETUP saying the field is only a label, so nobody greps it as a Worker name again).
- `tests/worker-config.test.ts` is unchanged: the guard never pinned the Worker name.

**Verified in this sandbox**
- `npm run lint` — pass. `npm run test:config` — 8 pass. `npm run test:worker` — 56 pass.
  `npm run test:auth` — 5 pass.
- `npx wrangler deploy --dry-run --config worker/wrangler.toml` — bundles clean
  (143.08 KiB / 35.75 KiB gzip) and lists all nine vars, including the real `SUPABASE_URL`.
- Parsed the file back: `name = mail`, `keep_vars = true`, nine vars present.

**Human steps still needed (owner)**
1. `npm run worker:secrets:list` — after this fix it targets `mail`. It must list
   `ACCOUNTS_INTERNAL_TOKEN`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`. Jo missing ho to
   Workers & Pages → `mail` → Settings → Variables and Secrets → **Production** → type
   **Secret** se add karo. Values chat me ya file me kabhi nahi.
2. Redeploy (`npm run worker:deploy`), then
   `curl -s https://mail.gothwadtech.com/api/health` — `configured` me chaaron `true` hone
   chahiye.
3. Dashboard me check karo ki koi leftover unused Worker `gothwad-mail-api` hai kya (purane
   deploy se). Agar hai to owner khud review karke delete kare — code se Cloudflare me kuch
   delete nahi karna.

---

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
