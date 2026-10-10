# How Gothwad Mail works

## The pieces

```
Browser ──► mail.gothwadtech.com
             ├─ static web app (Pages)            src/
             └─ /api/*  ──► Mail Worker           worker/src/index.ts
                              ├─► Accounts: who is signed in?   AUTH_HUB_URL/api/auth/me
                              ├─► Supabase (service key)        mail_messages table
                              └─► Resend (API key)              outbound mail

Internet mail ──► Email Routing (catch-all) ──► Mail Worker email() ──► Supabase
```

- The **browser** never has a Supabase or Resend key. It only calls `/api/*` on the same
  origin.
- The **Mail Worker** is the only place that holds the keys. They are secrets.
- **Accounts** is the source of truth for who is signed in. Mail never stores passwords and
  never makes its own login.

## Identity and the email address

1. The browser calls `GET /api/session`. The Worker forwards the browser's cookies to
   Accounts: `GET {AUTH_HUB_URL}/api/auth/me`.
2. If Accounts says `authenticated: true`, the Worker takes `user.username`. The address is
   **derived**: `username@APP_DOMAIN`. Accounts does not store the email.
3. If the user is not signed in, the Worker returns **401** with
   `signinUrl = {AUTH_HUB_URL}/signin?choose=1`. The web app sends the browser there with
   `&next=` set to the Mail page, so the user comes back after signing in.
4. Accounts can rotate the refresh token on `/auth/me`. It then sends new `gothwad_*`
   cookies. The Worker passes those cookies on to the browser. If it did not, the user would
   be signed out of Accounts everywhere.
5. Bearer tokens (`Authorization: Bearer ...`) are checked with
   `GET {AUTH_HUB_URL}/api/oauth/userinfo`. This is for future clients. The web app does not
   use it.
6. Any Accounts failure other than "signed out" (timeout, 5xx) gives **503**, not a fake
   signed-out state.

Upstream redirects are never followed. A redirect from Accounts counts as "not signed in".

## The mailbox model

- One table: `public.mail_messages` (see `supabase/mail.sql`).
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
   happens before any parsing.
3. Parse MIME with `postal-mime`.
4. Store the text body (up to 200,000 characters) and the HTML body (up to 500,000
   characters). Each is truncated, not rejected.
5. Attachments: **metadata only** (`name`, `type`, `size`). Bytes are dropped. The reader says
   so. Storing tiny files is an open decision (see `PLAN.md`).
6. Insert with `folder = 'inbox'` and `to_username` set to the local part.

> Open decision: any local part on `APP_DOMAIN` is accepted. See `PLAN.md`.

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
