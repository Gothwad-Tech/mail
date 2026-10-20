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
}

export interface SessionInfo {
  user: SessionUser;
  accountUrl: string;
  limits: { dailySendLimit: number; sendRemainingToday: number | null };
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

export interface RetentionCleanup {
  trashPurged: number;
  trimmed: number;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public signinUrl?: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (init.body !== undefined) headers['content-type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: init.method || 'GET',
      credentials: 'include',
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new ApiError(0, 'network', 'Cannot reach Gothwad Mail right now. Check your connection.');
  }

  const data = (await res.json().catch(() => null)) as
    | (Record<string, unknown> & { message?: string; error?: string; signinUrl?: string })
    | null;

  if (!res.ok) {
    throw new ApiError(
      res.status,
      data?.error || 'error',
      data?.message || `Request failed (${res.status}).`,
      data?.signinUrl
    );
  }
  return data as T;
}

export const mailApi = {
  getSession: () => request<SessionInfo & { authenticated: true }>('/session'),

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

  send: (payload: { to: string[]; cc: string[]; bcc: string[]; subject: string; body: string; draftId?: string }) =>
    request<{ id: string | null; sent: true; saved: boolean; remainingToday: number }>('/mail/send', {
      method: 'POST',
      body: payload,
    }),
};
