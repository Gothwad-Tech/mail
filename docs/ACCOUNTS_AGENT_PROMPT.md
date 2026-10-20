# Prompt for the Gothwad Accounts agent — multi-account sessions

Copy everything below the line into the Accounts agent's session. It is written to be
self-contained: the Accounts agent only needs its own repo plus this text.

Related plan on the Mail side: [`MULTI_ACCOUNT_PLAN.md`](./MULTI_ACCOUNT_PLAN.md).

---

## Task

Add **Google-style multiple signed-in accounts** to Gothwad Accounts, so that every Gothwad
app (starting with Mail at `https://mail.gothwadtech.com`) can show an account switcher and
change the active account **in about a second, without signing out and without a password
re-entry**.

Today Accounts keeps exactly one signed-in identity per browser. That is the only reason Mail
shows a single mailbox. The fix belongs here, in Accounts, not in each app.

## Hard rules

1. **Do not break the current single-account behaviour.** With the new code deployed but the
   new UI unused, `GET /api/auth/me` must answer exactly as it does today. Every consumer
   (Mail, Accounts' own pages, any other app) keeps working with zero changes.
2. **No passwords re-entered to switch.** Switching between accounts that are already signed
   in on this browser is one request.
3. **No new required secrets** and **no manual SQL**. If you need a table, it must self-bootstrap
   on demand from the Worker (same pattern as the existing bootstrap), and it must work on the
   free tier. Prefer storing the list in cookies and adding **no** table at all.
4. **Cookie-only identity.** No token in `localStorage`/`sessionStorage` — one XSS would leak
   every signed-in account at once.
5. Do not touch `GothwadTech/mail` or other app repos.
6. Update `docs/MAIL_INTERNAL.md` (the naming table) and your own `TASK.md` in the same PR.
7. Everything cross-origin must be **server-side proxied** or explicitly CORS-allowed, and the
   design must survive `SameSite` cookie rules. Details below.

## Identity model (recommended)

All Gothwad apps live on `*.gothwadtech.com`, which is the same site, so `SameSite=Lax`
cookies work everywhere. Keep it that way; do not introduce a cross-site flow.

```
gothwad_sess_<slot>     one real session per account   slot = a,b,c…  (Path=/; HttpOnly; Secure; SameSite=Lax; Domain=.gothwadtech.com)
gothwad_accounts        signed list of slots + display data        (HttpOnly; Secure; SameSite=Lax; read by the server, not by JS)
gothwad_active          which slot is active right now            (HttpOnly; Secure; SameSite=Lax)
gothwad_*               existing cookies keep working as the "slot a"/legacy session
```

* `gothwad_accounts` holds **no secrets**: `v1.<base64url(json)>.<hmac>` where json is
  `[{slot, username, firstName, lastName, addedAt, lastUsedAt}]`. It is HMAC-signed with a
  server key so the browser cannot invent an account. Never put a session token, refresh token
  or email password in it.
* The **active** slot is a cookie, not a query parameter, so every app's existing
  `GET /api/auth/me` keeps resolving a single identity and each app's code stays unchanged.
* If `gothwad_active` is missing or points at a slot whose session no longer validates,
  fall back to the legacy behaviour (the pre-existing session cookie). Result: an old browser
  that never used the switcher behaves exactly as today.

Slot naming must be stable and non-guessable-ish but does not need to be secret (it is only
a slot index). `a`…`f` is enough (6 accounts, Google's browser limit is similar).

## API contract

All endpoints are cookie-authenticated, same-origin to Accounts, JSON in / JSON out.

### 1. `GET /api/auth/accounts`

List every slot with a session that still resolves. Drop dead slots opportunistically and
re-issue `gothwad_accounts` without them (a stale slot must never show in the UI).

```json
{
  "activeId": "a",
  "accounts": [
    { "id": "a", "username": "pawan", "firstName": "Pawan", "lastName": "Sharma",
      "email": "pawan@gothwadtech.com", "lastUsedAt": "2026-10-20T11:02:00.000Z" },
    { "id": "b", "username": "work", "firstName": "", "lastName": "",
      "email": "work@gothwadtech.com", "lastUsedAt": "2026-10-19T09:10:00.000Z" }
  ]
}
```

* `email` is `username@<app domain>`; derive it server-side, never accept it from the client.
* Signed out entirely → `401 { "authenticated": false }` (same shape rule as `/api/auth/me`).
* Accounts unreachable or misrouted → `503`, **never** `401`. (Mail depends on this rule; see
  `worker/src/session.ts` in the Mail repo: a 401 means "signed out" and bounces to the chooser,
  which would loop.)

### 2. `POST /api/auth/switch`  body `{ "id": "b" }`

* Validates that slot `b` has a **usable** session (re-check it, do not trust the list cookie).
* Sets `gothwad_active=b`, updates `lastUsedAt`, rotates the target session the same way
  `/auth/me` rotates today, and returns the same body as `GET /api/auth/accounts`.
* Unknown / revoked slot → `409 { "error": "account_not_signed_in" }`. The UI then removes it
  from the list and offers "sign in again" for that account.
* Must be `POST` and must reject a request with no `Origin`/`Referer` from a Gothwad host
  (CSRF). Keep the existing CSRF approach; do not weaken it.

### 3. `POST /api/auth/accounts/:id/signout`

Signs out **only** that slot: clears its session cookie, removes it from
`gothwad_accounts`, and if it was active, sets `gothwad_active` to the most recently used
remaining slot (or clears the cookie if none are left). Returns the updated list.
`sign out` for the last account must fully sign the browser out (today's behaviour).

### 4. Add-another-account flow

`GET /signin?choose=1&add=1` must let the user sign in with **another** account and **append**
it to `gothwad_accounts` (allocating the next free slot) instead of replacing the current one.
Signing in without `add=1` keeps today's behaviour (replace). After success, redirect to the
`next` URL as usual.

`GET /signin?choose=1` should also list the already-signed-in accounts, with an
"Use another account" entry, so the chooser matches the switcher.

### 5. Unchanged endpoints

`GET /api/auth/me`, the OAuth endpoints and `/api/internal/usernames/:username` keep their
current shapes and status codes. `/api/auth/me` may return the extra fields
`{ "account": { "id": "b" } }` — Mail can use it later, but nothing may depend on it.

## Constraints the Mail integration depends on

Mail proxies these calls server-to-server and forwards `Set-Cookie` to the browser. So:

1. Every response that changes cookies must send them as **individual `Set-Cookie` headers**
   (Mail re-sends them with `getSetCookie()`). No combined header.
2. Cookie names must match `^gothwad_[a-z_]+=` (Mail only forwards that prefix) and cookie
   names for slots must match `^gothwad_sess_[a-z]$` — no dots, no uppercase.
3. No `__Host-` / `__Secure-` prefixes: Mail forwards the cookies to `.gothwadtech.com`, and
   those prefixes forbid a `Domain` attribute.
4. Bodies stay small and JSON; no HTML error pages on `/api/*`.
5. Idempotent switch: calling `POST /api/auth/switch` twice with the same id is a no-op success.

## Tests you must add

Cover, at minimum:

1. Two accounts signed in → `GET /api/auth/accounts` returns both, `activeId` correct.
2. `POST /api/auth/switch` changes what `GET /api/auth/me` reports, **without** any credential.
3. Switch to a slot whose session was revoked → `409`, list drops it, active stays unchanged.
4. `POST /api/auth/accounts/:id/signout` for the inactive account leaves the active one signed in.
5. Sign out the last account → `GET /api/auth/me` returns `401`.
6. `gothwad_accounts` tampered with (flipped byte) → treated as absent, legacy fallback works,
   no crash and no 500.
7. Legacy browser (only the old cookie) → unchanged behaviour on all endpoints.
8. CSRF: `POST /api/auth/switch` without a Gothwad Origin is rejected.

## Delivering

Ship one PR in the Accounts repo that answers, in its description:

* the exact cookie names and flags you ended up with,
* the exact request/response for the four endpoints above (copy from tests),
* proof that `/api/auth/me` is byte-compatible for a single-account browser,
* a `curl` transcript showing switch from `a` to `b` and back, with `GET /api/auth/me`
  changing identity between the two calls.

When that PR is merged and deployed, Mail's switcher UI can go live immediately — the Mail
side is already specified in `MULTI_ACCOUNT_PLAN.md`.
