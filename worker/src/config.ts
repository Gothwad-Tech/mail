// =============================================================================
// Worker config + env typing.
//
// Why: the domain and URLs come from env so the same code works when the
// company moves from gothwadtech.com to gothwad.in. We only keep fallback
// defaults here so a missing var does not break the Worker silently.
//
// Secrets (ACCOUNTS_INTERNAL_TOKEN, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY) are
// set with `wrangler secret put` or in the dashboard. Never put them in wrangler.toml.
// =============================================================================

export interface Env {
  // Public config (wrangler.toml [vars])
  APP_DOMAIN?: string;
  AUTH_HUB_URL?: string;
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

  const extraOrigins = (env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => stripTrailingSlash(s.trim()))
    .filter(Boolean);

  return {
    appDomain: (env.APP_DOMAIN || DEFAULT_APP_DOMAIN).trim().toLowerCase(),
    authHubUrl: stripTrailingSlash((env.AUTH_HUB_URL || DEFAULT_AUTH_HUB_URL).trim()),
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
