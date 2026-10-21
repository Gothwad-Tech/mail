# TASK.md — session log

Updated every session. Newest first.


## 2026-10-21 — Gmail-level multi-account: `/u/<n>/` URLs, per-tab isolation, hard 500-line rule

**Owner request:** switcher bilkul Google jaisa ho — har tab ka apna account, URL me account
dikhe, aur ek account ki row doosre account ke frame me kabhi na aaye. Plus file-size rule ko
sach me enforce karo.

**What changed**

- **URL is the state.** Canonical `/u/<n>/#<folder>`. Aliases (`/mail/u/n/`, `/?authuser=n`,
  `/?u=n`, `/?login=1&authuser=n`, `/?folder=`) are rewritten once with `replaceState`
  (`src/services/authuser.ts`). One-shot params (`compose=1`, `__mail_auth_return=1`) survive the
  rewrite; the folder lives only in the hash, so folder nav never touches the account.
- **One account per tab.** Every API call sends `X-Gothwad-Authuser: <n>`; the Worker validates
  it and forwards it to Accounts as the tab selector (`worker/src/authuser.ts`). Two tabs, one
  cookie jar, two mailboxes — verified by `worker/test/multitab.test.ts` (parallel reads, send
  From, cross-account 404).
- **Paint order.** `MailProvider` keyed by slot id + per-slot caches
  (`src/services/mailboxCache.ts`), and switching is optimistic: flush draft → URL + session →
  background `POST /switch`. The UI test records **every** painted frame and asserts no frame
  shows bob's list with an alice row.
- **Accounts numbering is respected.** `parseAccounts` sorts by Accounts' `authuser` before
  numbering 0..n, and an upstream `accountUrl` is used verbatim; a promoted account therefore
  really is the index the UI navigates to (regression found by the sign-out UI test).
- **Sign-out per account**, active or not: the shown account's hop goes to the promoted slot and
  drops that mailbox cache; the inactive one leaves the open mailbox untouched.
- **Keyboard + layout:** `Shift+A` opens the sheet, `↑/↓` move, `Enter` switches, `Esc` closes;
  `role="dialog"`, focus starts on the active row; safe-area bottom padding on phones.
- **Deep links:** `public/_redirects` (`/u/*`, `/mail/u/*` → `/index.html` 200), `public/_headers`
  (`max-age=0, must-revalidate`), `appType: 'spa'`, and one manifest only (`manifest: false` in
  the PWA plugin — it used to emit a second, differently-iconed copy).
- **Hard 500-line rule:** `tools/check-file-sizes.mjs` now fails over 500 (no 800 escape hatch)
  and covers `.js/.css/.html/.sql/.md`. `TASK.md` was 663 lines, so its older sessions moved to
  `docs/TASK_ARCHIVE.md` (nothing deleted).

**Tests:** 141 pass (`npm test`) — worker 82, UI 12, D1 15, config 10, auth 5, routing 10,
assets 7, plus the size gate. `npm run lint`, `npm run build` (308 kB / 91.7 kB gzip) and
`wrangler deploy --dry-run` clean. Fixed on the way: the SPA rewrite dropped
`__mail_auth_return`, and the dev Accounts stub had a stale `authuser` after sign-out.

## 2026-10-20 — File size rule (500 target / 800 max) + the splits it required

**Owner request:** ek permanent rule docs me likho — koi bhi code file 500–800 lines ke andar
rahe, try 500 tak; jo file pehle se badi hai use parts me todo **bina functionality/logic
badle**. Sirf likhna nahi, abhi follow bhi karo.

**Rule (AGENTS.md #12, now enforced, not a note):**

- target **≤ 500 lines**, hard max **800**, per `.ts` / `.tsx` / `.mjs`
- over 500 → split in the same session; behaviour identical (same exports, same logic, same
  user-visible text, same tests)
- docs/lock/CSS/JSON/generated output exempt
- `npm run check:sizes` (`tools/check-file-sizes.mjs`) fails > 800, warns > 500, and runs as
  the **first** step of `npm test` — so rule yaad rakhne par depend nahi karta

**Splits done in this session (all behaviour-preserving):**

| Before | After |
| --- | --- |
| `worker/test/worker.test.ts` **1291** | `helpers.ts` 262 + `health` 68, `session` 260, `messages` 142, `mutations` 121, `drafts` 64, `send` 118, `settings` 96, `inbound` 173, `misc` 60, `accounts` 255 |
| `src/context/MailContext.tsx` **944** | `MailContext.tsx` 252 (composition) + `mailContextTypes.ts` 141, `mailHelpers.ts` 69, `useMailbox.ts` 312, `useCompose.ts` 180, `useMailboxSettings.ts` 80, `useAccountsSwitcher.ts` 119 |
| `worker/src/mail.ts` **527** | `mail.ts` 19 (barrel) + `mail-types.ts` 187, `mail-read.ts` 86, `mail-write.ts` 271 |

Test harness: one `helpers.ts` with real in-memory SQLite + a replaceable upstream stub, and a
live `h` object (`h.env`, `h.stub`, `h.seen`) so every test file shares the same beforeEach
wiring. `test:worker` now runs `worker/test/*.test.ts`.

`toEmailMessage` / `toComposeData` are still re-exported from `MailContext`, so components did
not change. `useMail()` contract is untouched.

**Verified:** `npm run lint` clean, `npm run check:sizes` clean (57 files), `npm test` →
**108 pass** (config 10, auth 5, worker 72, d1 15, ui 6), `npm run build` OK
(304.41 kB / 90.21 kB gzip), preview + `/api/mail/accounts` still fine. `dev-dist/` added to
`.gitignore`.

---

## 2026-10-20 — Account switcher built on the Mail side (Google flow), tested end to end

**Owner request:** accounts agent ko prompt de diya; Mail side parallel me banao — Google jaisa
flow: ek hi profile section, saare signed-in accounts, tap par ~1 second switch.

**Backend — `worker/src/accounts.ts` (new)**

- `GET /api/mail/accounts`: proxies Accounts' list, then adds **per-account unread counts** from
  Mail's D1 in one grouped query, only for usernames Accounts just verified.
- `POST /api/mail/accounts/switch` `{id}`: proxies the switch, forwards rotated `Set-Cookie`
  (reuses `keepAccountsCookies`), 401 only when Accounts really says signed out, 409
  `account_not_signed_in` when the slot's session is gone.
- `POST /api/mail/accounts/signout` `{id}`: per-account sign-out.
- `GET /api/mail/accounts/add`: 302 to `{AUTH_SIGNIN_URL}/signin?choose=1&add=1&next=…`, built
  from config (no open redirect).
- Accounts 404 (feature not deployed) → `{ accounts: [], unread: {}, unsupported: true }`, so
  Mail ships first and lights up later. Validation drops bad slot ids/usernames/duplicates, and
  emails are derived server-side.
- 14 new worker tests on real SQLite with a stubbed Accounts (72 total).

**Frontend**

- `mailApi`: `getAccounts`, `switchAccount`, `signOutAccount` + `AccountSummary`/`AccountsInfo`.
- `useSession`: `refresh()` re-reads the session **without** the full-screen loading state.
- `MailContext`: accounts state (`accounts`, `activeAccountId`, `accountUnread`,
  `accountsUnsupported`, `switchingAccountId`), `refreshAccounts` (one GET per page load, no
  polling), `switchAccount` (clears folder/detail/prefetch caches, selection, draft, then asks App
  to re-read the session), `signOutAccount`.
- `App.tsx`: `<MailProvider key={user.username}>` → a switch remounts the provider, so no cache
  can survive an account change.
- `AccountSheet`: the real switcher — avatar + name + address + unread pill + check on the active
  row, spinner on the row being switched, per-row sign-out (confirm only for the last account),
  “Add another account”. Single-account fallback card when Accounts has not shipped yet.
- `Header`: `+n` bubble on the avatar when more accounts exist, `Shift+A` opens the sheet.
- `tools/dev-server.mjs`: two-account Accounts stub (alice/bob) driven by a `gothwad_active`
  cookie, so the preview and the UI test exercise the real switch path.

**Verified**

- `npm run lint` clean. `npm test` → **108 pass** (config 10, auth 5, worker **72**, d1 15,
  ui **6** — the new one opens the switcher, taps bob, and asserts the app is fully bob after).
- Manual: `GET /api/mail/accounts` → alice+bob with unread; `POST switch {id:"b"}` → 200,
  `set-cookie: gothwad_active=b`; `GET /api/session` with that cookie → `bob@gothwadtech.com`.
- `npm run build` → main 302.40 kB (89.84 kB gzip); still one lazy chunk per modal.

**Pending:** live check with the two real accounts once the Accounts PR lands.

---

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

---

Older sessions (D1 migration, the worker-name/URL fixes, the first real UI) are in
[`docs/TASK_ARCHIVE.md`](docs/TASK_ARCHIVE.md).
