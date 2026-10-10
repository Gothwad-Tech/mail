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
| `SUPABASE_SERVICE_ROLE_KEY` | `sb_secret_...` (or legacy `eyJ...`) | **secret** |
| `RESEND_API_KEY` | `re_...` | **secret** |

The domain and URLs are not secrets. Keys are. Keys go in with `wrangler secret put`
or in the Cloudflare dashboard, never in `wrangler.toml` or git.

---

## 1. Supabase: create the mail table (same project as Accounts)

1. Open the Supabase dashboard for the **same project** that Gothwad Accounts uses.
2. Go to **SQL Editor**. Paste the whole file `supabase/mail.sql` and run it once.
   It is safe to run again.
3. Check: the table `public.mail_messages` exists, and RLS is on.

The browser never talks to this table. The Worker does, with the service key.

---

## 2. Accounts: allow the Mail app to use its callback (SQL, for the Accounts owner)

> **This SQL is for a human to review and run in the Accounts Supabase project. It is NOT
> run by the Mail project or by an agent.**

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

Set the two secrets (you will be asked to paste the value in your terminal):

```bash
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY --config worker/wrangler.toml
npx wrangler secret put RESEND_API_KEY --config worker/wrangler.toml
```

Edit `worker/wrangler.toml`:
- Set `SUPABASE_URL` to your real project URL (replace `YOUR_PROJECT_REF`). The Worker
  refuses to call Supabase while the placeholder is still there.
- Check `APP_DOMAIN`, `AUTH_HUB_URL` and `MAIL_URL`.

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

## 5. Cloudflare: Email Routing (inbound)

1. Dashboard → your zone (`gothwadtech.com`) → **Email → Email Routing**. Enable it. It
   adds the MX and TXT records for you. If the domain already receives mail elsewhere,
   read the warning first.
2. **Routing rules → Catch-all**: set the action to **Send to a Worker**, pick
   `gothwad-mail-api`.
3. Send a test email to `YOUR_USERNAME@gothwadtech.com` from outside. It should appear in
   the Inbox after a few seconds.

Unknown domains are rejected with 550. Oversized mail (over `MAX_INBOUND_BYTES`) is
rejected with 552.

> Open decision: today every local part on the domain is accepted (see `PLAN.md`).

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
npm run test:worker   # 30 tests, no network
npm run test:ui       # jsdom smoke test; needs the Worker running and a signed-in cookie
```

`test:ui` sends the cookie `gothwad_at=good` by default. Point it at a Worker that accepts
that cookie, or set `MAIL_TEST_COOKIE` to a real cookie from your own browser session.
Never paste a real session cookie into chat or into a committed file.

---

## Checklist

- [ ] `supabase/mail.sql` run once in the Accounts project
- [ ] Accounts `ecosystem_apps` SQL reviewed and run by the Accounts owner
- [ ] Secrets set with `wrangler secret put` (not in files)
- [ ] `SUPABASE_URL` in `wrangler.toml` is the real project URL
- [ ] Worker deployed; `/api/health` answers from the Worker
- [ ] Route `mail.gothwadtech.com/api/*` points at the Worker
- [ ] Web app hosted on `mail.gothwadtech.com`
- [ ] Email Routing on, catch-all sends to `gothwad-mail-api`
- [ ] Resend domain verified; send key set as a secret
- [ ] Test: sign in, send to yourself, reply, star, trash
