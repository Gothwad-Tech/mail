# Multi-account (Google-style account switcher) — plan

**Goal:** Mail should behave like Google's account switcher. Both accounts that are signed in at
`accounts.gothwadtech.com` appear in one profile section, with avatars and unread counts, and
tapping one switches the whole app to that mailbox **in about a second** — no password, no
sign-out, no full page reload wherever we can avoid it.

**Owner summary (Hinglish):** Accounts app me 2 login already hain, lekin unhme se sirf ek hi
mailbox dikhta hai kyunki Accounts abhi ek hi session rakhta hai. Isliye kaam do hisson me hai —
pehle Accounts multi-session de (prompt ready hai), phir Mail uske upar switcher UI banaye. Mail
ka D1 data pehle se per-user hai, to Mail me sirf session + UI badalna hai, data migrate nahi karna.

---

## 1. Why it does not work today

`worker/src/session.ts` resolves exactly one identity per request: the browser's cookie is
forwarded to `GET {AUTH_HUB_URL}/api/auth/me`, and Accounts answers with **one** user. Accounts
keeps one session per browser, so the second login replaced the first from Mail's point of view
(the second account is still signed in, but nothing lets Mail point at it).

Two consequences worth stating up front:

* This **cannot** be fixed in Mail alone. A per-app account list would mean Mail storing other
  accounts' credentials — exactly the thing we must never do.
* It **does not need a data migration**. Every mail row is already scoped by `username`; switching
  the session simply changes which `username` the queries filter on.

## 2. Target behaviour (Google parity)

| Google | Gothwad Mail after this work |
| --- | --- |
| Avatar/initial at top right → account list | Same, in the existing `AccountSheet` and the sidebar avatar |
| Each row: avatar, name, email, unread badge | Same, unread count from Mail's D1, per account |
| Tap a row → that account's Gmail opens instantly | Tap → Mail reloads caches for that account, list paints in ~1s |
| "Add another account" → sign-in page, account is added | `accounts.gothwadtech.com/signin?choose=1&add=1`, returns to Mail |
| "Sign out" per row, "Manage your Google Account" | Per-row sign out, plus the existing "Manage Gothwad Account" link |
| No password to switch; account stays signed in | Session cookie per account, active slot cookie |
| Switcher never shows a dead account | Accounts verifies each slot on every list call |

Deliberate non-goals: no "open both accounts side by side", no per-account window isolation, no
alias/combined inbox. Keep it simple — owner's standing rule.

## 3. Split of work

### Part A — Accounts repo (blocked on that team/agent)

Full specification: [`ACCOUNTS_AGENT_PROMPT.md`](./ACCOUNTS_AGENT_PROMPT.md). Summary:

* per-account session cookies `gothwad_sess_a…f` + signed `gothwad_accounts` list + `gothwad_active`
* `GET /api/auth/accounts`, `POST /api/auth/switch`, `POST /api/auth/accounts/:id/signout`,
  `GET /signin?choose=1&add=1`
* `GET /api/auth/me` unchanged and still single-identity (so Mail needs **no** change to
  `session.ts`)
* 8 tests listed there, including tampered-cookie and CSRF cases

**Everything below is blocked until this ships.** Building the Mail UI first would demo a
switcher that switches nothing.

### Part B — Mail repo (this repo)

**B1. Proxy, not CORS** (`worker/src/index.ts`, `worker/src/accounts.ts` — new file)

The browser never calls Accounts directly. Mail proxies three calls and forwards `Set-Cookie`
with the existing `takeUpstreamCookies` mechanism from `session.ts`, which already handles cookie
rotation safely:

```
GET  /api/mail/accounts          -> { activeId, accounts: [...], unread: { "b": 12 } }
POST /api/mail/accounts/switch   -> { id } -> same body as above
POST /api/mail/accounts/signout  -> { id } -> same body as above
GET  /api/mail/accounts/add       -> 302 to {AUTH_SIGNIN_URL}/signin?choose=1&add=1&next=…
```

Rules for B1:

* Each account's `unread` count comes from **Mail's** D1 (`folder='inbox' AND is_read=0`) for the
  usernames returned by Accounts. Never accept a username from the request body; the list is
  server-derived, so an attacker cannot probe another mailbox.
* Upstream 401/403 → Mail 401 (signed out). Anything else unreadable → 503 with the existing
  `auth_unavailable` / `accounts_unexpected_response` codes. Same rule as `session.ts`; never turn
  a broken handoff into a sign-out.
* If Accounts answers 404 (this feature not deployed yet), Mail returns
  `{ activeId: null, accounts: [], unread: {} }` plus `unsupported: true`. The UI then hides the
  switcher and Mail behaves exactly as it does today. **This is the deployment safety net**: Mail
  can ship before Accounts, and light up automatically afterwards.
* No new secrets, no new binding, no cron. One extra upstream GET per switcher open (not per page
  load), cached in the tab for 60s.

**B2. Session plumbing** (`src/services/mailApi.ts`, `src/hooks/useSession.ts`, `MailContext`)

* `mailApi.getAccounts() / switchAccount(id) / signOutAccount(id)` + `AccountsInfo` type.
* `useSession` keeps its current contract, plus an `accounts` field. Failure handling unchanged:
  a 503 must still never redirect.
* Add `reloadSession()` and `resetForAccountSwitch()` to `MailContext`. The reset **must** clear
  `folderCacheRef`, `detailCacheRef`, the selected message, the open draft and the compose state,
  then re-run `loadFolder(currentFolder)`. Rationale: showing one account's cached inbox after
  switching to another would be a privacy leak, not just a stale-data bug.

**B3. Switcher UI** (`src/components/AccountSheet.tsx`, `src/components/Sidebar.tsx`,
`src/components/Header.tsx`, `src/components/MobileDrawer.tsx`)

* New "Accounts" list at the top of `AccountSheet`: avatar circle, name, `username@gothwadtech.com`,
  unread pill (`bg-[#0494f4]`, white text), check-mark on the active row, and a subtle
  "Switching…" spinner on the row being switched. Rows are ≥ 56px tall.
* Footer: `+ Add another account` (opens `/api/mail/accounts/add`) and, per row on hover/long
  press, a small `Sign out` action.
* While the sheet opens, keep the last known list rendered (no spinner) and refresh in the
  background; the list request is one round trip.
* Trigger: the existing avatar in `Sidebar`/`Header`/`MobileDrawer` (already opens `AccountSheet`).
  On mobile it stays a bottom sheet with the grab handle; on desktop it centres.
* Add an avatar stack (2–3 overlapping circles) next to the trigger when more than one account is
  signed in, so it is obvious the switcher exists.

**B4. Instant switch, no reload**

1. `POST /api/mail/accounts/switch` (fast, one round trip).
2. `resetForAccountSwitch()` clears caches, resets `session` to the new user, sets the tab title.
3. `loadFolder(currentFolder)` runs immediately, showing skeletons — never the previous account's
   rows. Target: **under 1s** on a warm client because the list query is indexed and the ETag path
   is already in place.
4. Full `window.location.reload()` is only a fallback if any fetch fails with 401.

**B5. Polish**

* Tab title reflects the active account's unread count only (`(3) Gothwad Mail`), so a glance at
  the tab never mixes mailboxes.
* Draft switching: an open compose draft is per account, so it must be closed (not silently
  carried) on switch, with the confirmation kept to a single `window.confirm` at most — or simply
  discarded with a toast. Keep it simple: discard + toast "Draft not sent · account switched".
* `prefers-reduced-motion` respected for the switch animation (already global in `index.css`).
* Service worker stays out of `/api/*`; nothing about accounts may ever be cached on disk.

## 4. Security checklist

| Risk | Mitigation |
| --- | --- |
| Tampered account list shows a fake mailbox | List cookie is HMAC-signed; Mail only uses usernames Accounts returns, and only after Accounts verifies each session |
| Switching without authentication | `POST /api/auth/switch` re-validates the target session and requires a Gothwad Origin |
| Cross-account data leak via caches | Every cache is cleared on switch, **before** the first paint; `/api/*` never cached by the SW |
| XSS steals all accounts | Nothing in `localStorage`; all session material is `HttpOnly` cookies |
| Enumeration of other users' unread counts | Unread counts are computed only for usernames in the server-verified list |
| Loop between Mail and Accounts on failure | Unchanged 401-only-means-signed-out rule; 503 stays on-screen with Retry |

## 5. Order of work

1. **Accounts Part A** (other repo, other agent). Blocks everything below. ✅ prompt ready.
2. **B1 + B2** — proxy endpoints + session plumbing, behind the `unsupported` fallback. Verifiable
   with local fixtures before Accounts ships; ships safely to production on its own.
3. **B3 + B4** — switcher UI and instant switch.
4. **B5** — polish, then a full pass on mobile and desktop.
5. Live verification with two real accounts at `accounts.gothwadtech.com`, then a walkthrough.

## 6. Acceptance tests (must all pass before "done")

**Status: green.** Each item below names the automated test that now holds it. Local run:
`npm test` → 141 tests (13 of them end-to-end UI), plus `npm run lint`, `npm run build` and
`npx wrangler deploy --dry-run --config worker/wrangler.toml`.

| # | Test |
|---|------|
| 1 | `tests/ui-switcher.test.tsx` — list, active row, unread pills |
| 2 | `tests/ui-switcher.test.tsx` — "paint order" (MutationObserver, every frame) |
| 3 | `worker/test/accounts.test.ts` — 409 → `reauthUrl`; `useAccountsSwitcher` redirects |
| 4 | `worker/test/accounts.test.ts` — upstream 404 → `unsupported: true` |
| 5 | `worker/test/accounts.test.ts` — 503 keeps the last known list |
| 6 | `worker/test/accounts.test.ts` — `add` builds `/signin?add=1&authuser=n+1&next=/u/n+1/` |
| 7 | `tests/ui-switcher.test.tsx` — signing out the inactive account |
| 8 | `tests/ui-switcher.test.tsx` — signing out the shown account hops to the promoted one |
| 9 | `worker/test/accounts.test.ts` — signout of the last slot reports `signedOutAll` |
| 10 | `tests/ui-switcher.test.tsx` — `Shift+A`, `↑/↓`, `Enter`, `Esc` |
| 11 | `tests/ui-switcher.test.tsx` — 390×844 and 1440×900 class contract |
| 12 | `tests/ui-switcher.test.tsx` (web storage) + `tests/assets.test.ts` (SW never caches `/api`) |

Extra coverage added with the URL work: `tests/routing.test.ts` (`/u/n/`, aliases, hash folders,
one-shot params, Back/Forward), `tests/assets.test.ts` (root-relative assets, single manifest,
Pages rewrites), `worker/test/multitab.test.ts` (two tabs reading and sending concurrently).

Original list, kept for reference:

1. Two accounts in the list, correct active row, correct unread pills.
2. Switch `a → b`: exactly one `POST`, `folderCacheRef`/`detailCacheRef` empty, list painted from
   `b` only, no `a` row visible at any point (assert the first painted frame).
3. Switch to a slot revoked meanwhile → `409` surfaces as "This account is signed out. Sign in
   again.", the row disappears, active account unchanged, mailbox still usable.
4. Accounts returns 404 (feature not deployed) → no switcher, app behaves exactly as today.
5. Accounts returns 503 → switcher still opens from the last known in-memory list, no redirect,
   no sign-out.
6. Add account → returns to Mail with the new account active, one more row, previous account
   still signed in.
7. Sign out of the inactive account → active mailbox untouched, still signed in.
8. Sign out of the active account with another one remaining → switches to the most recent
   remaining account instead of a full sign-out.
9. Sign out of the last account → full sign-out screen, "Sign in" link works.
10. Keyboard: trigger `a`? (already used for other shortcut — pick an unused one, e.g. `Shift+A`)
    opens the switcher, `↑/↓` + `Enter` switch accounts, `Esc` closes.
11. Mobile (390×844) and desktop (1440×900): sheet fully visible, safe-area padding honoured,
    no horizontal scroll, tap targets ≥ 44px.
12. No `localStorage`/`sessionStorage` keys contain account data; SW cache contains zero `/api/*`.

Regression: the whole existing suite (`npm test`, 93 tests) stays green, `npm run lint` clean,
`npm run build` succeeds, prod `curl /api/health` still reports `ready: true`.

## 7. Cost

$0. No new Worker, no new D1, no KV, no cron, no polling. Switching is one `POST` plus one list
`GET`; the per-account unread counts are the same indexed `COUNT(*)` the folder list already runs.
Free-tier D1 read usage goes up by roughly one extra list query per switch — negligible.

## 8. Rollback

* Mail side: the switcher is additive. If Accounts misbehaves, Mail's `unsupported`/503 path hides
  it and the app is exactly today's app. Reverting the Mail PR is safe at any time because no
  tables or columns change.
* Accounts side: keeping the legacy session cookie as the fallback slot means removing the new
  cookies restores single-account behaviour without a data change.
