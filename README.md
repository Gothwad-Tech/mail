# Gothwad Mail

Webmail for `username@APP_DOMAIN` addresses. You sign in with **Gothwad Accounts**, and
your address comes from your username.

- **Web app**: React + Vite + Tailwind PWA (`src/`).
- **Mail Worker** (`worker/`): Cloudflare Worker. REST API under `/api/*`, plus the inbound
  Email handler.
- **Storage**: Supabase in a separate Mail project (`supabase/mail.sql`).
- **Outbound**: Resend, called only from the Worker.

Folders: **Inbox, Starred, Sent, Drafts, Trash**.

No demo data. Mailbox ownership comes from the verified Accounts session; messages live in
Mail's own database. Inbound addresses are checked through Accounts' internal API.

## Quick start (local)

```bash
npm install
cp .env.example .env.local           # public settings only; no secrets
cp worker/.dev.vars.example worker/.dev.vars   # local secrets; fill in your own values

npm run worker:dev                   # Worker on http://127.0.0.1:8787
npm run dev                          # web app on http://localhost:3000 (proxies /api)
```

Without a signed-in Accounts session, the app sends you to the Accounts sign-in page. For
local work you can set `DEV_AUTH_USERNAME` in `worker/.dev.vars` (development only).

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Web app (Vite, port 3000) |
| `npm run build` | Production build into `dist/` |
| `npm run lint` | Typecheck the web app and the Worker |
| `npm run test:worker` | Worker tests (no network) |
| `npm run test:auth` | Sign-in redirect/return URL tests (no network) |
| `npm run test:ui` | jsdom smoke test of the real app (needs the Worker running) |
| `npm run worker:dev` | Worker locally (`wrangler dev`) |
| `npm run worker:deploy` | Deploy the Worker |

## Configuration

Public settings are in `worker/wrangler.toml` (`APP_DOMAIN`, `AUTH_HUB_URL`,
`AUTH_SIGNIN_URL`, `MAIL_URL`, `SUPABASE_URL`, `DAILY_SEND_LIMIT`, `MAX_INBOUND_BYTES`).
Secrets are `ACCOUNTS_INTERNAL_TOKEN`, `SUPABASE_SERVICE_ROLE_KEY` and `RESEND_API_KEY`; set
them with `wrangler secret put`.

`AUTH_HUB_URL` is the base for every server-side Accounts call and must reach the Accounts
Worker (`https://api.gothwadtech.com`, its Custom Domain). `AUTH_SIGNIN_URL` is used only for
browser-facing links — the sign-in redirect and `accountUrl` — and falls back to
`AUTH_HUB_URL` when unset. Set both on the deployed Worker too (dashboard → Settings →
Variables and Secrets → Production); see `docs/SETUP.md`.

Nothing in the code hardcodes the domain. Fallback defaults may use `gothwadtech.com`.

## Deploy

Follow **[docs/SETUP.md](docs/SETUP.md)**. It covers the separate Mail Supabase project,
optional Accounts SSO SQL, Worker secrets and deployment. Do not enable Email Routing until
the Accounts username endpoint is confirmed working.

## Docs

- [docs/SETUP.md](docs/SETUP.md): human setup steps (dashboards, DNS, secrets).
- [docs/MAIL.md](docs/MAIL.md): how sign-in, sending, drafts, inbound and limits work.
- [AGENTS.md](AGENTS.md): rules for working on this repo.
- [PLAN.md](PLAN.md): status and open decisions.
- [TASK.md](TASK.md): session log.

## Security notes

- The browser never gets the Supabase service key or the Resend key.
- Every mail query is scoped to the signed-in user's username.
- Email HTML is shown in a sandboxed iframe with no scripts.
- Writes from the browser must come from the app's own origin and send JSON.
- The send cap (default 30 a day per user) limits abuse and keeps the free tier safe.

## Known limits

- Attachments: only name, type and size are kept. The bytes are not stored yet.
- Inbound is accounts-only: mail is kept only when Accounts' internal username endpoint confirms the name. Unknown names get a 550 bounce; lookup failures get 451. Email Routing stays off until the endpoint is confirmed working.
- No Undo for Trash. No restore from Trash yet.
- Refresh is manual. There is no polling.
