// =============================================================================
// Worker config + env typing.
//
// Why: the domain and URLs come from env so the same code works when the
// company moves from gothwadtech.com to gothwad.in. We only keep fallback
// defaults here so a missing var does not break the Worker silently.
//
// Two Accounts URLs, because Accounts answers differently per host:
//   AUTH_HUB_URL     base for every SERVER-side fetch (/api/auth/me,
//                    /api/oauth/userinfo, /api/internal/usernames/:username).
//                    This must be a host that reaches the Accounts Worker,
//                    e.g. its Custom Domain api.gothwadtech.com.
//   AUTH_SIGNIN_URL  base for browser-facing links only (sign-in redirect and
//                    accountUrl). Cloudflare does not run a same-zone Worker
//                    behind a Pages host for a server-to-server call, so the
//                    Pages host answers HTML and is unusable as AUTH_HUB_URL.
// AUTH_SIGNIN_URL is optional and falls back to AUTH_HUB_URL, so a deployment
// that sets only AUTH_HUB_URL keeps working exactly as before.
//
// Secrets (ACCOUNTS_INTERNAL_TOKEN, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY) are
// set with `wrangler secret put` or in the dashboard. Never put them in wrangler.toml.
// =============================================================================

export interface Env {
  // Public config (wrangler.toml [vars])
  APP_DOMAIN?: string;
  AUTH_HUB_URL?: string;
  AUTH_SIGNIN_URL?: string;
  MAIL_URL?: string;
  SUPABASE_URL?: string;
  ENVIRONMENT?: string; // "production" (default when unset) or "development"
  ALLOWED_ORIGINS?: string; // extra comma-separated origins for CORS / CSRF checks
  DAILY_SEND_LIMIT?: string;
  MAX_INBOUND_BYTES?: string;

  // Local-only (.dev.vars). Ignored unless ENVIRONMENT=development.
  DEV_AUTH_USERNAME?: string;

  // Secrets
  ACCOUNTS_INTERNAL_TOKEN?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  RESEND_API_KEY?: string;
}

export interface Config {
  appDomain: string;
  authHubUrl: string;
  authSigninUrl: string;
  mailUrl: string;
  supabaseUrl: string;
  accountsInternalToken: string | null;
  allowedOrigins: string[];
  isProduction: boolean;
  dailySendLimit: number;
  maxInboundBytes: number;
  devAuthUsername: string | null;
}

const DEFAULT_APP_DOMAIN = 'gothwadtech.com';
const DEFAULT_AUTH_HUB_URL = 'https://accounts.gothwadtech.com';
const DEFAULT_MAIL_URL = 'https://mail.gothwadtech.com';

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

function toPositiveInt(value: string | undefined, fallback: number): number {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function readConfig(env: Env): Config {
  const isProduction = env.ENVIRONMENT !== 'development';
  const mailUrl = stripTrailingSlash((env.MAIL_URL || DEFAULT_MAIL_URL).trim());
  const authHubUrl = stripTrailingSlash((env.AUTH_HUB_URL || DEFAULT_AUTH_HUB_URL).trim());

  const extraOrigins = (env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => stripTrailingSlash(s.trim()))
    .filter(Boolean);

  return {
    appDomain: (env.APP_DOMAIN || DEFAULT_APP_DOMAIN).trim().toLowerCase(),
    authHubUrl,
    // Falls back to AUTH_HUB_URL so a deployment that only sets AUTH_HUB_URL
    // keeps its old behaviour (one Accounts host for both roles). An empty or
    // blank AUTH_SIGNIN_URL also falls back rather than producing a bad URL.
    authSigninUrl: stripTrailingSlash(env.AUTH_SIGNIN_URL?.trim() || authHubUrl),
    mailUrl,
    supabaseUrl: stripTrailingSlash((env.SUPABASE_URL || '').trim()),
    accountsInternalToken: env.ACCOUNTS_INTERNAL_TOKEN?.trim() || null,
    allowedOrigins: [mailUrl, ...extraOrigins],
    isProduction,
    dailySendLimit: toPositiveInt(env.DAILY_SEND_LIMIT, 30),
    maxInboundBytes: toPositiveInt(env.MAX_INBOUND_BYTES, 10 * 1024 * 1024),
    // Dev bypass: only ever honoured outside production.
    devAuthUsername: !isProduction && env.DEV_AUTH_USERNAME ? env.DEV_AUTH_USERNAME : null,
  };
}

/**
 * True when SUPABASE_URL is a real project URL (not the wrangler.toml placeholder).
 * Local dev may point at a loopback stub, but never in production.
 */
export function isSupabaseConfigured(config: Config): boolean {
  if (/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(config.supabaseUrl)) return true;
  return !config.isProduction && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(config.supabaseUrl);
}

/**
 * Which settings this Worker instance can actually see. Booleans only - never a
 * value, never a prefix, never a length. `/api/health` returns this so a var or
 * secret that a deploy removed is obvious right away, instead of surfacing later
 * as a confusing 503. Deploys can wipe plain-text dashboard vars; secrets survive.
 */
export function configStatus(env: Env, config: Config): Record<string, boolean> {
  return {
    supabaseUrl: isSupabaseConfigured(config),
    supabaseServiceKey: Boolean(env.SUPABASE_SERVICE_ROLE_KEY?.trim()),
    accountsInternalToken: Boolean(config.accountsInternalToken),
    resendApiKey: Boolean(env.RESEND_API_KEY?.trim()),
  };
}
