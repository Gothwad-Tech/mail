# Startup: what the app waits for, and what it does not

The app used to hide everything behind one full-screen screen ("Checking your Gothwad
account…") until a single `/api/session` request had done all of this in order:

1. one Accounts verification (`GET {AUTH_HUB_URL}/api/auth/me`, which can also rotate cookies),
2. a D1 connection, including the automatic schema bootstrap,
3. the "how many did I send today" count,
4. the unread counts for every signed-in account,
5. the JSON body, which then unlocked the whole app.

Steps 3 and 4 only feed a badge and a one-line label. If D1 was cold, slow or failing, the
mailbox — which needs a verified identity and nothing else — was still not allowed to render.

## The split

| Request | Costs | Blocks the shell? | Used for |
| --- | --- | --- | --- |
| `GET /api/session?meta=0` | one Accounts verification, zero D1 | **yes** (identity) | user, this tab's account, the switcher list, the accounts links |
| `GET /api/session/meta` | D1: unread counts + send count | no | unread badges, "x of y sends left today" |
| `GET /api/mail/messages?folder=…` | D1 | no (it has its own skeletons) | the inbox rows |
| `GET /api/session` | both halves | not used by the app | unchanged response for other consumers |

The shell paints as soon as identity is verified. `src/hooks/useSession.ts` owns the identity
gate; `src/hooks/useSessionMeta.ts` owns the optional strip. `src/App.tsx` only passes numbers
down when they belong to the account on screen.

## Rules this keeps

* **Auth is not weakened.** Identity still goes through `resolveSession()` in the Worker: 401
  only for a confirmed anonymous browser (with `signinUrl`), 503 (`auth_unavailable` /
  `accounts_unexpected_response`) for offline, 429, 5xx, HTML, redirects and malformed bodies.
  Rotated `Set-Cookie` headers are forwarded one header each.
* **Unknown is not zero.** `unread` is `null` until it is known (a real empty mailbox returns
  `{}`), and `limits.sendRemainingToday` is `null` when the count failed. The sidebar shows a
  skeleton, then either the number or a retry; it never prints "0 of 30" as a guess. The send
  cap is still enforced inside `POST /api/mail/send`, which re-counts before sending, so the
  label being late (or wrong) cannot allow an extra send.
* **One request, many consumers.** `src/services/sessionClient.ts` shares one in-flight request
  per endpoint **and account selector** (`identity:<authuser>`, `meta:<authuser>`). Two mounts,
  a React StrictMode double effect, or a widget + sidebar asking at once produce one network
  call. Nothing is cached after it settles: no long-lived authenticated payload in memory, Web
  Storage, Cache Storage or the service worker.
* **Cancellation and generations.** Callers `release()` when they stop caring; the last release
  aborts the fetch. Every attempt carries a generation, and every meta answer is tagged with the
  `authuser` it was computed for. A late answer for account A is dropped instead of repainting
  account B, and an abandoned attempt cannot restore a signed-out session.
* **The widget still does not block auth.** `preloadAccountWidget()` runs after identity, is
  `requestIdleCallback`-based, and its failure only switches the sheet to Mail's in-app fallback.

## Measured locally (not a production promise)

Local source: `npm run preview:api` (Worker + SQLite via `node:sqlite`) on this machine. These
numbers show the *shape* of the change; production D1 adds network latency that these runs do
not have.

| Observation | Result |
| --- | --- |
| `GET /api/session?meta=0` vs `GET /api/session` (5 runs each) | identity ≈ 0.9–1.1 ms, full ≈ 1.2–2.5 ms |
| Shell paint while `/api/session/meta` is held for 2 s | shell at **138 ms**, quota strip at **2152 ms** — the old app would have shown the gate for the whole 2 s |
| Requests during startup on one account | 1 identity + 1 meta + 1 mailbox page (identity is shared, not repeated) |
| Accounts verifications per Worker request | 1 (the identity route) — never two in the same request |

The honest claim is therefore: **the shell no longer waits for unread counts or the send quota
at all.** How much faster that feels in production depends on D1 latency at that moment, which
Mail does not measure from the browser.

## Regression tests

* `worker/test/session-meta.test.ts` — identity does zero D1 work; the meta route's badges and
  quota; broken D1 becomes `null`, not zeros; anonymous 401 + `signinUrl`; offline, 429, 500,
  HTML, redirect and malformed answers become retryable 503s with no sign-in redirect; rotated
  cookies stay separate; selector isolation.
* `tests/session-startup.test.ts` — request sharing, selector isolation, abort on last release,
  no caching after settle, per-account headers.
* `tests/ui-startup.test.tsx` — shell paints while metadata is pending; a failed metadata call
  leaves the mailbox usable and offers a strip-local retry; a late answer for the previous
  account never repaints the new account's strip.
