# AGENTS.md — rules for working on Gothwad Mail

Read this before you change anything. Keep it up to date. Do not delete it.

## What this repo is

Gothwad Mail is a webmail app for `username@APP_DOMAIN` addresses.

- **Frontend**: Vite + React + Tailwind (`src/`). Calls same-origin `/api`. Has no secrets.
- **Mail Worker** (`worker/`): Cloudflare Worker. Serves the REST API under `/api/*` and
  handles inbound email (Email Routing `email()` handler). It is the only thing that
  talks to Supabase (service key) and Resend (API key).
- **Database**: Supabase, the **same project as Gothwad Accounts** (shared identity DB).
  Schema in `supabase/mail.sql`. Run by a human in the SQL editor. Never run by an agent.
- **Identity**: Gothwad Accounts (`AUTH_HUB_URL`). Mail never has its own login. It asks
  Accounts who is signed in (`/api/auth/me` with the browser's cookies, or
  `/api/oauth/userinfo` for bearer tokens).

Read `docs/MAIL.md` for how it works and `docs/SETUP.md` for the human setup steps.

## Hard rules (from the project owner)

1. **Do not edit the Accounts repo** (`GothwadTech/accounts`). Do not invent Accounts
   endpoints. Read it if you need to check one (read-only). Do not merge Mail into Accounts.
2. **Never hardcode the domain in logic.** Use env: `APP_DOMAIN`, `AUTH_HUB_URL`,
   `MAIL_URL`, `SUPABASE_URL`. Fallback defaults may contain `gothwadtech.com`.
3. **Never commit real keys.** `.env.example` and `wrangler` examples hold placeholders
   only. Secrets go in with `wrangler secret put` or the dashboard. Never ask the user to
   paste a live key or password into chat.
4. **Browser never calls Supabase or Resend.** Mail is sent only by the Worker.
   The Supabase `sb_secret_` key goes in the `apikey` header only, never `Authorization`
   (except legacy `eyJ` service-role keys, which need both).
5. **No demo data in the production build.** No fake names, no mock threads.
   The only data is what the Worker returns.
6. **Free tier only. Zero paid budget.** No paid services, no paid add-ons.
7. **No polling loops.** Refresh is manual (or on user action).
8. **Attachments: tiny only (under 200 KB total), otherwise skip with a note.**
   Today: attachment bytes are never stored. Only name, type and size are kept, and the UI
   says so. Storing tiny files is a future decision (see `PLAN.md`).
9. **Per-user daily send cap** (default 30, range 20–50). Config: `DAILY_SEND_LIMIT`.
10. **Keep the existing visual design.** Replace mocks with API hooks; do not restyle.
11. **Comment the "why" in code**, not the "what". Keep comments short and plain.
12. **Talk to the user in simple English or Hinglish.**
13. **Update `TASK.md` every session.**
14. **Never delete `AGENTS.md` once created.**

## Working rules

- Work only on branch `arena/a9ca7ef8-mail`. Push only to it.
- Check the worker with `worker/tsconfig.json`. Do **not** run the root tsconfig over
  `worker/` (the DOM and workers libs clash). The root tsconfig excludes `worker/`.
- Before you say something works, run the checks:
  - `npm run lint` (root and worker typecheck)
  - `npm run build`
  - `npm run test:worker` (27+ Worker tests, no network)
  - `npm run test:ui` (jsdom smoke test; needs `npm run worker:dev` plus a signed-in
    cookie. See `docs/SETUP.md`, "Local checks")
- `wrangler deploy --dry-run` should bundle cleanly before any deploy.
- Read big files in small `sed -n` ranges. Do not `cat` a huge file in one go.
- Local secrets go in `worker/.dev.vars` (git-ignored). Never commit it.
- Do not add `[[routes]]` or change production DNS/Email Routing from code. Those are
  human steps in `docs/SETUP.md`.

## Known things not to retry

- Revoking the `authenticated` role on `mail_messages` made the RLS policy inert. Only `anon`
  is revoked now.
- Draft autosave duplicated drafts when the draft id was read from a stale closure. Fixed
  with refs and a single-flight flush in `MailContext.tsx`. Keep it that way.
- `decodeURIComponent` throws on bad `%` input. It is wrapped and returns 400.
- The Worker must forward rotated `gothwad_*` Set-Cookie headers from Accounts to the
  browser. Dropping them signs the user out of Accounts (refresh-token rotation).
