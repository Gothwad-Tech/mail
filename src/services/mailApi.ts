// =============================================================================
// Browser client for the Mail Worker API.
//
// Why relative /api: in production the Worker is routed on
// mail.gothwadtech.com/api/*. In dev, Vite proxies /api to `wrangler dev`.
// Either way the browser stays on one origin, so the session cookie is sent
// and no CORS setup is needed.
//
// The browser never has a Resend key and never sees D1. Only this API is called.
// =============================================================================

import type { ComposeData, EmailFolder } from '../types/email';
import { authUserHeaders } from './authuser';

const API_BASE = '/api';

// Error codes the Worker can send back. The 503 codes mean the Gothwad Account
// is signed in but Mail could not read it, so the app must show a retry message
// instead of sending the browser to Accounts again (that looped the chooser).
export const API_ERROR = {
  unauthenticated: 'unauthenticated',
  authUnavailable: 'auth_unavailable',
  accountsUserInvalid: 'accounts_user_invalid',
  accountsUnexpectedResponse: 'accounts_unexpected_response',
} as const;

export interface SessionUser {
  username: string;
  email: string;
  name: string | null;
  /** Name parts, so the account widget can draw Accounts-style initials. */
  firstName?: string;
  lastName?: string;
  /** Accounts profile photo (already resolved upstream), or null. */
  avatarUrl?: string | null;
}

/** Daily send cap plus what is left today. `null` means "not known yet". */
export interface SessionLimits {
  dailySendLimit: number | null;
  sendRemainingToday: number | null;
}

/** Both limits unknown: the label hides instead of claiming a number. */
export const UNKNOWN_LIMITS: SessionLimits = { dailySendLimit: null, sendRemainingToday: null };

/**
 * Who is signed in, plus everything the shell needs.
 *
 * `unread` and `limits` are the optional half: the identity request
 * (`?meta=0`) leaves them `null`, and a second, non-blocking call fills them in
 * through {@link SessionMetaInfo}. `null` always means "not known yet" — never a
 * zero, because "0 unread" would be a claim the app cannot back up.
 */
export interface SessionInfo {
  user: SessionUser;
  /** This tab's account index (/u/<n>/), 0..5. */
  authuser: number;
  /** Accounts slot id for that index ("a".."f"). */
  activeId: string | null;
  /** Every account signed in in this browser, in stable order. */
  accounts: AccountSummary[];
  /** username -> unread inbox count, or null while it is not loaded yet. */
  unread: Record<string, number> | null;
  /** Accounts' profile page for the current account. */
  accountUrl: string;
  /**
   * Origin of the Accounts web app (from the Worker's config). The shared
   * account widget is loaded from `${accountsWebOrigin}/widget/account-menu.js`,
   * so no domain is ever hardcoded in the browser bundle.
   */
  accountsWebOrigin?: string;
  /** Send quota, or null while it is not loaded yet. */
  limits: SessionLimits | null;
  /** False on the identity half, true on the combined `/api/session` answer. */
  meta?: boolean;
}

/** The deferred half of the session (`GET /api/session/meta`). */
export interface SessionMetaInfo {
  /** Which account these numbers belong to, so a late answer can be ignored. */
  authuser: number;
  unread: Record<string, number> | null;
  limits: SessionLimits;
}

export interface ApiMessage {
  id: string;
  folder: 'inbox' | 'sent' | 'drafts' | 'trash';
  from: { name: string | null; email: string };
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  snippet: string;
  receivedAt: string;
  isRead: boolean;
  isStarred: boolean;
  attachments: Array<{ name: string; type: string; size: number }>;
  bodyText?: string;
  bodyHtml?: string | null;
}

export type RetentionLimit = 500 | 1500 | 0;

export interface MailboxSettings {
  retentionLimit: RetentionLimit;
  /** Bytes actually stored (compressed bodies) for this mailbox. */
  storageUsedBytes: number;
  /** Fair-use cap, 50 MB by default. */
  storageQuotaBytes: number;
  totalMessages: number;
  starredMessages: number;
  updatedAt?: string;
}

/** One signed-in Gothwad account, as listed by the Worker (see worker/src/accounts.ts). */
export interface AccountSummary {
  /** Accounts slot id ("a".."f"). */
  id: string;
  /** Google-style index used in the URL: /u/<authuser>/. */
  authuser: number;
  username: string;
  name: string | null;
  firstName: string;
  lastName: string;
  email: string;
  avatarUrl: string | null;
  /** Accounts' own profile page for this account. */
  accountUrl: string;
  lastUsedAt: string | null;
}

export interface AccountsInfo {
  activeId: string | null;
  authuser: number | null;
  accounts: AccountSummary[];
  /** username -> unread inbox count, computed in Mail's D1. */
  unread: Record<string, number>;
  /** Accounts has not deployed the multi-account API yet: hide the switcher. */
  unsupported?: true;
}

export interface RetentionCleanup {
  trashPurged: number;
  trimmed: number;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public signinUrl?: string,
    /** 409 on a switch: Accounts' sign-in link for that exact slot. */
    public reauthUrl?: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface ApiRequestInit {
  method?: string;
  body?: unknown;
  /** Owning page can cancel the call; an aborted call rejects with ApiError 0. */
  signal?: AbortSignal;
  /** Override the tab's account index (used by the deferred session call). */
  authuser?: number;
}

async function request<T>(path: string, init: ApiRequestInit = {}): Promise<T> {
  // Every call carries this tab's account index. That is what keeps /u/0 and
  // /u/1 independent: the Worker forwards it to Accounts, which resolves that
  // slot without touching the browser-wide active account.
  const headers: Record<string, string> = { accept: 'application/json', ...authUserHeaders(init.authuser) };
  if (init.body !== undefined) headers['content-type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: init.method || 'GET',
      credentials: 'include',
      headers,
      signal: init.signal,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    // Includes AbortError: a cancelled call is not a network failure the user
    // should be told about, so callers drop it by their own generation check.
    throw new ApiError(0, 'network', 'Cannot reach Gothwad Mail right now. Check your connection.');
  }

  const data = (await res.json().catch(() => null)) as
    | (Record<string, unknown> & { message?: string; error?: string; signinUrl?: string; reauthUrl?: string })
    | null;

  if (!res.ok) {
    throw new ApiError(
      res.status,
      data?.error || 'error',
      data?.message || `Request failed (${res.status}).`,
      data?.signinUrl,
      data?.reauthUrl
    );
  }
  return data as T;
}

export const mailApi = {
  /**
   * Identity only: one Accounts verification, zero database work, so the shell
   * can paint without waiting for unread badges or the send quota.
   */
  getSession: (opts: { signal?: AbortSignal; authuser?: number } = {}) =>
    request<SessionInfo & { authenticated: true }>('/session?meta=0', opts),

  /** The deferred half: unread badges + send quota. Never blocks the shell. */
  getSessionMeta: (opts: { signal?: AbortSignal; authuser?: number } = {}) =>
    request<SessionMetaInfo>('/session/meta', opts),

  listMessages: (folder: EmailFolder, opts: { before?: string; limit?: number } = {}) => {
    const qs = new URLSearchParams({ folder, limit: String(opts.limit ?? 50) });
    if (opts.before) qs.set('before', opts.before);
    return request<{ messages: ApiMessage[]; nextBefore: string | null }>(`/mail/messages?${qs.toString()}`);
  },

  getMessage: (id: string) => request<{ message: ApiMessage }>(`/mail/messages/${encodeURIComponent(id)}`),

  patchMessage: (id: string, patch: { isRead?: boolean; isStarred?: boolean; moveToTrash?: boolean }) =>
    request<{ message: ApiMessage }>(`/mail/messages/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch }),

  deleteTrashed: (id: string) =>
    request<{ ok: true }>(`/mail/messages/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  saveDraft: (draft: ComposeData) =>
    request<{ message: ApiMessage }>('/mail/drafts', { method: 'POST', body: draft }),

  deleteDraft: (id: string) => request<{ ok: true }>(`/mail/drafts/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  getSettings: () => request<MailboxSettings>('/mail/settings'),

  updateSettings: (retentionLimit: RetentionLimit) =>
    request<MailboxSettings & { cleanup: RetentionCleanup }>('/mail/settings', {
      method: 'PATCH',
      body: { retentionLimit },
    }),

  /** Signed-in accounts for the switcher (empty + unsupported before Accounts ships). */
  getAccounts: () => request<AccountsInfo>('/mail/accounts'),

  switchAccount: (target: { id?: string; authuser?: number }) =>
    request<AccountsInfo>('/mail/accounts/switch', { method: 'POST', body: target }),

  signOutAccount: (id: string) =>
    request<AccountsInfo & { signedOutAll: boolean }>('/mail/accounts/signout', { method: 'POST', body: { id } }),

  /** Signs every account out of this browser (Accounts' `/auth/signout`). */
  signOutAll: () =>
    request<{ ok: true; signedOutAll: true }>('/mail/accounts/signout-all', { method: 'POST', body: {} }),

  /** Accounts' re-auth link for one slot (used when a switch returns 409). */
  reauthUrl: (authuser: number, username?: string) => {
    const qs = new URLSearchParams({ login: '1', authuser: String(authuser), next: `/u/${authuser}/` });
    if (username) qs.set('username', username);
    return `https://accounts.gothwadtech.com/signin?${qs.toString()}`;
  },

  send: (payload: { to: string[]; cc: string[]; bcc: string[]; subject: string; body: string; draftId?: string }) =>
    request<{ id: string | null; sent: true; saved: boolean; remainingToday: number }>('/mail/send', {
      method: 'POST',
      body: payload,
    }),
};
