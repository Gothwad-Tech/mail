# How Gothwad Mail works

## The pieces

```
Browser ──► mail.gothwadtech.com
             ├─ static web app (Pages)            src/
             └─ /api/*  ──► Mail Worker           worker/src/index.ts
                              ├─► Accounts: who is signed in?   AUTH_HUB_URL/api/auth/me
                              ├─► Supabase (service key)        Mail project's mail_messages
                              └─► Resend (API key)              outbound mail

Internet mail ──► Email Routing (catch-all) ──► Mail Worker email()
                                                   ├─► Accounts username endpoint
                                                   └─► Mail Supabase project
```

- The **browser** never has a Supabase or Resend key. It only calls `/api/*` on the same
  origin.
- The **Mail Worker** is the only place that holds the keys. They are secrets.
- **Accounts** is the source of truth for who is signed in. Mail never stores passwords and
  never makes its own login. Mail has its own Supabase project and does not read the Accounts
  database or `public.profiles`.

## Identity and the email address

1. The browser calls `GET /api/session`. The Worker forwards the browser's cookies to
   Accounts: `GET {AUTH_HUB_URL}/api/auth/me`.
2. If Accounts says `authenticated: true`, the Worker takes `user.username`. The address is
   **derived**: `username@APP_DOMAIN`. Accounts does not store the email.
3. If the user is not signed in, the Worker returns **401** with
   `signinUrl = {AUTH_HUB_URL}/signin?choose=1`. The web app sends the browser there with
   `&next=` set to the Mail page. A one-time `__mail_auth_return=1` marker is included in
   that return URL so Mail can tell a failed SSO handoff from the initial sign-in.
4. Accounts can rotate the refresh token on `/auth/me`. It then sends new `gothwad_*`
   cookies. The Worker passes those cookies on to the browser. If it did not, the user would
   be signed out of Accounts everywhere.
5. Bearer tokens (`Authorization: Bearer ...`) are checked with
   `GET {AUTH_HUB_URL}/api/oauth/userinfo`. This is for future clients. The web app does not
   use it.
6. **A 401 from Mail may only ever mean "Accounts says this browser is signed out".** Any
   other answer Mail cannot read is a **503** with its own error code (table below), so a
   broken Accounts handoff can never be mistaken for a signed-out user and bounce the browser
   back to the chooser in a loop.
7. Upstream redirects are never followed (`redirect: 'manual'`). A 3xx from Accounts is an
   Accounts routing problem, reported as 503 `accounts_unexpected_response`.

#### `/api/session` status table

| What Accounts `GET /api/auth/me` answered | Mail `GET /api/session` |
| --- | --- |
| 401 / 403 (real signed-out) | 401 with `signinUrl` (unchanged) |
| 200, `authenticated: false` | 401 with `signinUrl` (unchanged) |
| 200, `authenticated: true`, usable `user.username` | 200 session (unchanged) |
| 200, `authenticated: true`, username missing or invalid | 503 `accounts_user_invalid` |
| 200, body is not Mail's JSON (e.g. HTML from a misrouted `/api/*`) or has no `authenticated` field | 503 `accounts_unexpected_response` |
| 3xx redirect from Accounts | 503 `accounts_unexpected_response` |
| network error, timeout, 5xx | 503 `auth_unavailable` (unchanged) |

Every failure above logs **one** `console.warn` line with the code, the upstream status and
the upstream content-type, for example
`accounts_check_failed code=accounts_unexpected_response status=200 content-type=text/html`.
Cookie values, tokens and response bodies are never logged.

The web app only redirects to Accounts for a **401 with a `signinUrl`**. Every 503 shows the
error screen with a **Retry** button. For `accounts_user_invalid` and
`accounts_unexpected_response` the message says the Gothwad Account is signed in but Mail
could not load the profile (it deliberately does not talk about an expired cookie).

### If Accounts keeps showing the chooser

If the browser returns to Mail and immediately lands on Accounts' chooser again, the `next`
URL has already worked: Mail received the marked return URL, but `GET /api/session` still
could not verify the Accounts session. Mail stops after that return and shows a message
instead of sending the browser through an endless chooser loop.

Check the status and the `error` code of `https://mail.gothwadtech.com/api/session` in the
browser's Network panel (only the status code and the `error` field — never paste a body that
may contain tokens):

- **401 `unauthenticated`** — Mail received no valid shared Accounts session cookie.
  In browser storage, check only that the `gothwad_at` and `gothwad_rt` cookies exist and
  their **Domain** is `.APP_DOMAIN` (for example, `.gothwadtech.com`), Path is `/`, and
  Secure is enabled. Never paste the cookie values into chat or a ticket. If they are
  missing, host-only, expired, or belong to a different browser profile, Mail cannot repair
  that from its own origin; the Accounts deployment/session-cookie setup needs attention.
- **503 `accounts_user_invalid`** — the user IS signed in, but the Accounts profile row has no
  username Mail can use. Accounts-side fix (falls back to the JWT metadata); if it still
  fails, check the Accounts `profiles` row for that user.
- **503 `accounts_unexpected_response`** — `/api/*` on `accounts.gothwadtech.com` is not
  reaching the Accounts Worker, or Accounts is redirecting. Check the Cloudflare Worker route
  `accounts.gothwadtech.com/api/*`.
- **503 `auth_unavailable`** — the Accounts Worker is down or Mail's `AUTH_HUB_URL` points at
  the wrong deployment.

Confirm that Accounts' `AUTH_HUB_URL` deployment sets the session cookies for the parent
domain, and that Mail's `AUTH_HUB_URL` points to that same deployment.

### Verification after both sides are deployed

1. In the same browser profile (do not share the body — it contains tokens), open
   `https://accounts.gothwadtech.com/api/auth/me` and check **only** the status code, that it
   is JSON, and the `authenticated` / `user.username` fields.
2. Reload `https://mail.gothwadtech.com`. Expected: the inbox loads (`/api/session` = 200).
   If it does not, the `/api/session` status and JSON `error` code now say which branch
   failed — use the list above.
3. Never paste cookie values, JWTs or refresh tokens into an issue, a PR or chat.

## The mailbox model

- One table: `public.mail_messages` in Mail's separate Supabase project (see `supabase/mail.sql`).
- `user_id` stays null; Mail does not map usernames to Accounts auth user IDs.
- Every row has `to_username`, the owner's username. **Every query filters on it**, using the
  username from the verified session. One user cannot read another user's row. A test covers
  this: Bob's message returns 404 when Alice asks.
- Folders: `inbox`, `sent`, `drafts`, `trash`. "Starred" is a filter on `is_starred`, not a
  folder.
- Sent mail is stored in the sender's mailbox with `folder = 'sent'`.

## API

All JSON. Everything except `/api/health` needs a signed-in session.

| Method | Path | What it does |
| --- | --- | --- |
| GET | `/api/health` | Liveness. No auth. |
| GET | `/api/session` | Who am I, my address, `accountUrl`, `sendRemainingToday`. |
| GET | `/api/mail/messages?folder=inbox\|starred\|sent\|drafts\|trash&limit=&before=` | One page, newest first (max 100). Returns `nextBefore` for "Load more". |
| GET | `/api/mail/messages/:id` | One message with its body. Opening a message does not mark it read; the browser does that with PATCH. |
| PATCH | `/api/mail/messages/:id` | Body: `{ isRead?, isStarred?, moveToTrash? }`. |
| DELETE | `/api/mail/messages/:id` | Permanent delete. Only for items already in Trash. |
| POST | `/api/mail/drafts` | Create or update a draft: `{ id?, to, cc, bcc, subject, body }`. |
| DELETE | `/api/mail/drafts/:id` | Delete a draft. |
| POST | `/api/mail/send` | Send: `{ to, cc?, bcc?, subject, body, draftId? }`. Returns 201 with `id`, `saved`, `remainingToday`. |

Errors use one shape: `{ error, message }`. Malformed ids return 400, not found returns 404,
and internal details are never shown outside development.

### Write requests (CSRF)

A write (POST/PATCH/DELETE) that uses cookies must:
- come from an **allowed origin** (`MAIL_URL`, plus `ALLOWED_ORIGINS` if set). Otherwise **403**.
- send `Content-Type: application/json`. Otherwise **415**.

Bearer-token requests skip the origin check, because they do not use cookies.

## Sending

1. Validate: recipients (max 25), subject, body (max 100,000 characters). Strip and check
   the addresses.
2. If `RESEND_API_KEY` is missing, return **503**.
3. Check the daily cap: sent rows today for this user, against `DAILY_SEND_LIMIT` (default
   30). Over the cap returns **429**.
4. Send through Resend from `username@APP_DOMAIN`. If Resend rate-limits us, return
   **429** with `provider_rate_limited`. If Resend is unreachable, return **502**.
5. Insert a copy in `sent`. If that insert fails, the response still says the mail was sent
   (`saved: false`). The failure is logged.
6. If a `draftId` was given, delete that draft.

## Drafts and autosave

- The compose window saves a draft about **2 seconds** after you stop typing (debounced).
- One save runs at a time, so a fast typist does not create duplicate drafts.
- An empty compose window deletes the draft it made earlier.
- Discarding a compose window deletes its draft.
- Opening a draft from the Drafts folder loads the full draft into compose.

## Inbound

The `email()` handler runs for each message that Email Routing sends to the Worker.

1. Reject if the recipient is not on `APP_DOMAIN` (**550**). The check is case-insensitive.
2. Reject if the raw message is over `MAX_INBOUND_BYTES` (default 10 MB) (**552**). This
   happens before any parsing or database call.
3. **Accounts-only:** the name must be a real Gothwad user. After validating its shape, the
   Worker sends the lowercased local part to
   `GET {AUTH_HUB_URL}/api/internal/usernames/:username` with
   `Authorization: Bearer <ACCOUNTS_INTERNAL_TOKEN>`. Accounts responds with
   `200 {"exists": true}` or `200 {"exists": false}`. True → continue; false → **550**.
   Bad shape → **550** with no network call. Missing token, network/timeout failure,
   non-200 response (including 401), or invalid JSON → **451** (sender retries). The Worker
   never guesses that a name exists and never reads Accounts' database. HTTP failures log
   only the status code, not the username or token. The Accounts `main` docs did not yet
   describe this endpoint when the Mail integration was prepared; do not enable Email
   Routing until the Accounts team confirms that the documented and deployed contract matches.
4. Parse MIME with `postal-mime`.
5. Store the text body (up to 200,000 characters) and the HTML body (up to 500,000
   characters). Each is truncated, not rejected.
6. Attachments: **metadata only** (`name`, `type`, `size`). Bytes are dropped. The reader says
   so. Storing tiny files is a later step (see `PLAN.md`).
7. Insert with `folder = 'inbox'` and `to_username` set to the normalized lowercase local part.

## The reader is safe by design

Email HTML is untrusted. The reader renders it in an `<iframe srcdoc>` with:
- `sandbox` **without** `allow-scripts` and without `allow-same-origin`. Scripts do not run,
  and the frame cannot touch the app or its cookies.
- A CSP meta tag: `default-src 'none'`, so only images, styles and fonts are allowed.

The Worker also returns the raw HTML. The iframe is the protection, not the server.

## Limits (defaults)

| What | Default | Config |
| --- | --- | --- |
| Sends per user per UTC day | 30 | `DAILY_SEND_LIMIT` (free plan: keep 20–50) |
| Inbound size | 10 MB | `MAX_INBOUND_BYTES` |
| Recipients per message | 25 | code (`MAX_RECIPIENTS`) |
| List page size | 50 in the app, max 100 in the API | code |
| Stored text / HTML | 200,000 / 500,000 chars | code |
| Attachments kept | metadata only | see `PLAN.md` |

## Why some choices were made

- **Service key only in the Worker**: it bypasses RLS, so it must never reach a browser.
- **RLS on, anon revoked**: a leaked anon key cannot read mail. The policy only matches the
  signed-in user's own `preferred_username`, as defense in depth.
- **No polling**: the free tier is limited, and manual refresh is enough for now.
- **Derived email**: Accounts does not store the email, so the address is always
  `username@APP_DOMAIN`, computed in one place.
