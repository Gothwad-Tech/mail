# Setup — steps for a human

These are the steps only a person can do: dashboards, DNS, SQL in the Supabase editor,
and secrets. An agent must not run them, and must not ask for live keys in chat.

Replace placeholders like `YOUR_PROJECT_REF`, `YOUR_DOMAIN` and `re_...` with your own values.

---

## 0. Pick your values

| Name | Example | Where it lives |
| --- | --- | --- |
| `APP_DOMAIN` | `gothwadtech.com` | `wrangler.toml` `[vars]` (public) |
| `AUTH_HUB_URL` | `https://accounts.gothwadtech.com` | `wrangler.toml` `[vars]` (public) |
| `MAIL_URL` | `https://mail.gothwadtech.com` | `wrangler.toml` `[vars]` (public) |
| `SUPABASE_URL` | `https://YOUR_PROJECT_REF.supabase.co` | `wrangler.toml` `[vars]` (public) |
| `SUPABASE_SERVICE_ROLE_KEY` | Mail project's `sb_secret_...` (or legacy `eyJ...`) | **secret** |
| `RESEND_API_KEY` | `re_...` | **secret** |
| `ACCOUNTS_INTERNAL_TOKEN` | Same value as Accounts' `MAIL_INTERNAL_TOKEN` | **secret** |

The domain and URLs are not secrets. Keys and the shared internal token are. Set them with
`wrangler secret put` or in the Cloudflare dashboard, never in `wrangler.toml` or git. Do
not paste the token into chat. The token value must match on the Accounts and Mail Workers.

---

## 1. Supabase: create a separate Mail project

1. Create a new Supabase project for Gothwad Mail. Do not reuse the Accounts project.
2. In this new project's **SQL Editor**, paste the whole file `supabase/mail.sql` and run
   it. It is safe to run again.
3. Check: the table `public.mail_messages` exists, and RLS is on.
4. Save this Mail project's Project URL and service-role key for the Worker steps below.
   Do not use the Accounts project's URL or key.

Mail does not read Accounts' `public.profiles`; the Worker stores `user_id` as null and uses
the Accounts HTTP endpoint for inbound username checks. The browser never talks to Mail's
table; only the Worker uses the Mail service key.

---

## 2. Accounts: optional `ecosystem_apps` SQL for cookie SSO

> **Optional for the current cookie SSO flow.** This SQL is for a human to review and run
> in the Accounts Supabase project, not the Mail project. An agent must not run it. The
> cookie sign-in flow does not need `/auth/callback`; keep this only if you want the future
> OAuth code flow's callback URI registered.

```sql
UPDATE public.ecosystem_apps
SET redirect_uris = ARRAY[
  'https://mail.gothwadtech.com/auth/callback',
  'http://localhost:5173/auth/callback'
]
WHERE id = 'gothwad-mail';
```

If the update changes 0 rows (the `gothwad-mail` row is missing), insert it. The Accounts
schema seeds this row, so this is only a fallback:

```sql
INSERT INTO public.ecosystem_apps (id, name)
VALUES ('gothwad-mail', 'Gothwad Mail')
ON CONFLICT (id) DO NOTHING;
```

Then run the UPDATE above again.

Notes:
- `localhost:5173` is the port Vite uses by default. This project's dev server uses port
  `3000` (`npm run dev`), so add `http://localhost:3000/auth/callback` too if you use it.
- The cookie sign-in flow does not need `/auth/callback`. The redirect list is kept so the
  OAuth code flow can be used later.

---

## 3. Cloudflare: deploy the Worker

Work from the repo root.

```bash
npm install
npx wrangler login            # opens a browser; do this yourself
```

Set these Mail Worker secrets (Wrangler prompts for each value in your terminal):

```bash
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY --config worker/wrangler.toml
npx wrangler secret put RESEND_API_KEY --config worker/wrangler.toml
npx wrangler secret put ACCOUNTS_INTERNAL_TOKEN --config worker/wrangler.toml
```

In the separate Accounts deployment, set `MAIL_INTERNAL_TOKEN` to the **same secret
value** as Mail's `ACCOUNTS_INTERNAL_TOKEN`. Set it through the Accounts team's approved
secret mechanism; never put it in either repo or paste it into chat.

Edit `worker/wrangler.toml`:
- Set `SUPABASE_URL` to your real project URL (replace `YOUR_PROJECT_REF`). The Worker
  refuses to call Supabase while the placeholder is still there.
- Check `APP_DOMAIN`, `AUTH_HUB_URL` and `MAIL_URL`.

The Mail Worker expects `GET {AUTH_HUB_URL}/api/internal/usernames/:username`, authenticated
with `Authorization: Bearer <ACCOUNTS_INTERNAL_TOKEN>`. It expects `200 {"exists": true}` or
`200 {"exists": false}`; any other status or invalid JSON causes a retryable 451. Accounts'
`main` docs did not yet document this endpoint when this Mail integration was prepared, so
this code follows the owner's supplied contract. If Accounts ships a different documented
path or response, align the Mail code and tests before enabling Email Routing.

Check the bundle, then deploy:

```bash
npm run lint
npm run test:worker
npx wrangler deploy --dry-run --config worker/wrangler.toml
npm run worker:deploy
```

Routes: add the production route for the API so that `mail.gothwadtech.com/api/*` goes to
this Worker. You can add it in the dashboard (**Workers & Pages → gothwad-mail-api →
Settings → Domains & Routes**), or add a `[[routes]]` block to `wrangler.toml`. The zone
`gothwadtech.com` must be on Cloudflare.

---

## 4. Cloudflare: host the web app (static files)

The Worker route only covers `/api/*`. The app's HTML, JS and CSS must be served on
`mail.gothwadtech.com` too.

```bash
npm run build                 # writes dist/
```

Upload `dist/` with **Cloudflare Pages** (free) and set `mail.gothwadtech.com` as its custom
domain. The Worker route for `/api/*` must win over Pages on that host. After deploying,
check it:

```bash
curl -i https://mail.gothwadtech.com/api/health    # should return JSON from the Worker
curl -i https://mail.gothwadtech.com/api/session   # should return 401 with signinUrl
```

If `/api/health` returns HTML, the route is not matching. Fix the route order before you go on.

---

## 5. Confirm Accounts, then enable Email Routing (inbound)

**Do not enable Email Routing or add the catch-all until the Accounts endpoint is deployed,
documented, and this check returns the expected 200 response.** The Accounts `main` docs did
not yet document the endpoint when this Mail integration was prepared. The Worker currently
follows the owner's supplied contract; if Accounts documents a different path or response,
update and retest Mail before continuing.

The Mail Worker expects
`GET {AUTH_HUB_URL}/api/internal/usernames/:username`, with
`Authorization: Bearer <ACCOUNTS_INTERNAL_TOKEN>`. A registered username should return
`200 {"exists": true}`; an unknown one should return `200 {"exists": false}`. A 401 means
the two secret values do not match or the Accounts secret is not set.

Run this in your own shell after setting `AUTH_HUB_URL` to the value from
`worker/wrangler.toml` and `USERNAME` to a real, lowercase Accounts username. The prompt
reads the secret without echoing or putting it in shell history:

```bash
read -rsp 'MAIL_INTERNAL_TOKEN: ' MAIL_INTERNAL_TOKEN; printf '\n'
curl -i -H "Authorization: Bearer $MAIL_INTERNAL_TOKEN" \
  "$AUTH_HUB_URL/api/internal/usernames/$USERNAME"
unset MAIL_INTERNAL_TOKEN
```

Only after it returns HTTP 200 with `{"exists": true}` for the known account:

1. Dashboard → your zone → **Email → Email Routing**. Enable it. It adds the MX and TXT
   records. If the domain already receives mail elsewhere, read the warning first.
2. **Routing rules → Catch-all**: set the action to **Send to a Worker**, pick
   `gothwad-mail-api`.
3. Send a test email to `YOUR_USERNAME@gothwadtech.com` from outside. It should appear in
   the Inbox.

Bad recipient shape or unknown Accounts usernames are rejected with 550. Accounts lookup
failures (including missing token, timeout, non-200 and bad JSON) get 451 so the sender
retries. Oversized mail (over `MAX_INBOUND_BYTES`) is rejected with 552.

---

## 6. Resend: outbound

1. In Resend, **add the domain** `gothwadtech.com`.
2. Add the DNS records Resend shows (SPF and DKIM, plus DMARC if you want it) in Cloudflare
   DNS. Wait until Resend shows the domain as verified.
3. Create an API key with **send** permission only. Put it in with
   `npx wrangler secret put RESEND_API_KEY --config worker/wrangler.toml`.

Mail goes out as `username@gothwadtech.com`. Without a verified domain, Resend will refuse.
Check Resend's pricing page for the current free-plan limits.

---

## 7. Local checks (optional, for development)

Terminal 1 — the Worker on port 8787:

```bash
npm run worker:dev
```

Terminal 2 — the web app on port 3000 (Vite proxies `/api` to 8787):

```bash
npm run dev
```

For local use, create `worker/.dev.vars` from `worker/.dev.vars.example` and fill in your own
values there. It is git-ignored. `ENVIRONMENT=development` enables the local-only
`DEV_AUTH_USERNAME` bypass. That bypass is ignored in production.

Tests:

```bash
npm run lint          # root and worker typecheck
npm run build
npm run test:worker   # Worker tests, no network
npm run test:ui       # jsdom smoke test; needs the Worker running and a signed-in cookie
```

`test:ui` sends the cookie `gothwad_at=good` by default. Point it at a Worker that accepts
that cookie, or set `MAIL_TEST_COOKIE` to a real cookie from your own browser session.
Never paste a real session cookie into chat or into a committed file.

---

## Checklist

- [ ] Separate Mail Supabase project created; `supabase/mail.sql` run there
- [ ] Accounts `ecosystem_apps` SQL reviewed and run by the Accounts owner (optional for cookie SSO)
- [ ] `ACCOUNTS_INTERNAL_TOKEN` (Mail) and `MAIL_INTERNAL_TOKEN` (Accounts) are the same secret
- [ ] Mail service key and Resend key set with `wrangler secret put` (not in files)
- [ ] `SUPABASE_URL` in `wrangler.toml` is the real Mail project URL
- [ ] Worker deployed; `/api/health` answers from the Worker
- [ ] Route `mail.gothwadtech.com/api/*` points at the Worker
- [ ] Web app hosted on `mail.gothwadtech.com`
- [ ] Accounts endpoint is documented and the human curl check returns the expected 200
- [ ] Only after the endpoint check: Email Routing enabled and catch-all sends to `gothwad-mail-api`
- [ ] Resend domain verified; send key set as a secret
- [ ] Test: sign in, send to yourself, reply, star, trash
