# Gothwad Mail

Webmail for `username@APP_DOMAIN` addresses. You sign in with **Gothwad Accounts**, and
your address comes from your username.

- **Web app**: React + Vite + Tailwind PWA (`src/`).
- **Mail Worker** (`worker/`): Cloudflare Worker. REST API under `/api/*`, plus the inbound
  Email handler.
- **Storage**: Supabase, in the same project as Accounts (`supabase/mail.sql`).
- **Outbound**: Resend, called only from the Worker.

Folders: **Inbox, Starred, Sent, Drafts, Trash**.

No demo data. Every message, name and address comes from the Worker, which gets them from
the Accounts session and the database.

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
| `npm run test:worker` | Worker tests (no network; 30 tests) |
| `npm run test:ui` | jsdom smoke test of the real app (needs the Worker running) |
| `npm run worker:dev` | Worker locally (`wrangler dev`) |
| `npm run worker:deploy` | Deploy the Worker |

## Configuration

Public settings are in `worker/wrangler.toml` (`APP_DOMAIN`, `AUTH_HUB_URL`, `MAIL_URL`,
`SUPABASE_URL`, `DAILY_SEND_LIMIT`, `MAX_INBOUND_BYTES`). Keys are secrets:
`SUPABASE_SERVICE_ROLE_KEY` and `RESEND_API_KEY`. Set them with `wrangler secret put`.

Nothing in the code hardcodes the domain. Fallback defaults may use `gothwadtech.com`.

## Deploy

Follow **[docs/SETUP.md](docs/SETUP.md)**. It covers the Supabase SQL, the Accounts redirect
SQL (for the Accounts owner), the Worker route, Email Routing, and the Resend domain.

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
- Inbound accepts any address on `APP_DOMAIN` for now. This is an open decision (see `PLAN.md`).
- No Undo for Trash. No restore from Trash yet.
- Refresh is manual. There is no polling.
