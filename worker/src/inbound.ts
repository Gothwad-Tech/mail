// =============================================================================
// Inbound mail: Cloudflare Email Routing -> this Worker's email() handler.
//
// Flow:
//   someone -> username@APP_DOMAIN
//   -> Cloudflare Email Routing (catch-all *@APP_DOMAIN -> this Worker)
//   -> domain check, size check, and username shape check
//   -> ask Accounts whether the username exists
//   -> parse MIME (postal-mime)
//   -> gzip the bodies and insert one row into D1 mail_messages (folder = 'inbox')
//   -> run retention so a flooded mailbox trims itself right away
//
// Why the Accounts API: Mail has its own database and must not read Accounts'
// profiles table. The email arrives from the internet, so this Worker decides
// which mailbox it belongs to.
//
// Free-tier guards:
//   - Messages above MAX_INBOUND_BYTES are rejected (SMTP 552).
//   - Attachment BYTES are never stored. We keep only name/type/size metadata.
//   - Body text and HTML are truncated to fixed limits BEFORE gzip, so no row
//     can ever approach Cloudflare D1's 2 MB row ceiling.
// =============================================================================

import PostalMime from 'postal-mime';
import type { Config, Env } from './config';
import { Db } from './db';
import {
  insertMessage,
  MAX_BODY_CHARS as MAX_STORED_TEXT_CHARS,
  MAX_STORED_HTML_CHARS,
  type AttachmentMeta,
} from './mail';
import { enforceRetention } from './retention';
import { normalizeUsername } from './session';

const MAX_SUBJECT_CHARS = 998;

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

function attachmentSize(content: string | ArrayBuffer | Uint8Array | undefined): number {
  if (!content) return 0;
  if (typeof content === 'string') return new TextEncoder().encode(content).byteLength;
  return content.byteLength;
}

function sanitizeFilename(name: string | undefined | null): string {
  const base = (name || 'attachment').replace(/[\r\n\\/]+/g, '_').trim();
  return truncate(base || 'attachment', 255);
}

/** Split "local@domain" and return the local part only when the domain is ours. */
export function localPartForDomain(address: string, appDomain: string): string | null {
  const at = address.lastIndexOf('@');
  if (at <= 0) return null;
  const local = address.slice(0, at).toLowerCase();
  const domain = address.slice(at + 1).toLowerCase();
  if (domain !== appDomain) return null;
  return local;
}

const ACCOUNTS_LOOKUP_TIMEOUT_MS = 5000;

/**
 * Ask Accounts, not its database, whether this mailbox name is registered.
 * Server-to-server call, so it goes to AUTH_HUB_URL like every other Accounts
 * fetch — never to AUTH_SIGNIN_URL, which is only for browser links.
 */
async function accountExists(username: string, config: Config): Promise<boolean> {
  const token = config.accountsInternalToken;
  if (!token) throw new Error('Accounts internal token is not configured');

  let response: Response;
  try {
    response = await fetch(`${config.authHubUrl}/api/internal/usernames/${encodeURIComponent(username)}`, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/json',
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(ACCOUNTS_LOOKUP_TIMEOUT_MS),
    });
  } catch {
    // Network failures have no status code to log. Never log the address or token.
    console.error('inbound_account_lookup_failed');
    throw new Error('Accounts username lookup failed');
  }

  if (response.status !== 200) {
    console.error('inbound_account_lookup_failed', response.status);
    throw new Error('Accounts username lookup failed');
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    console.error('inbound_account_lookup_failed', response.status);
    throw new Error('Accounts username lookup failed');
  }

  if (!body || typeof body !== 'object' || typeof (body as { exists?: unknown }).exists !== 'boolean') {
    console.error('inbound_account_lookup_failed', response.status);
    throw new Error('Accounts username lookup failed');
  }

  return (body as { exists: boolean }).exists;
}

export async function handleInbound(message: ForwardableEmailMessage, config: Config, env: Env): Promise<void> {
  const local = localPartForDomain(message.to, config.appDomain);
  if (!local) {
    message.setReject('550 5.1.1 Unknown recipient');
    return;
  }

  // Check the size cap before making any network request.
  if (message.rawSize > config.maxInboundBytes) {
    message.setReject('552 5.3.4 Message too large');
    return;
  }

  // Bad name shapes are rejected before calling Accounts.
  const username = normalizeUsername(local);
  if (!username) {
    message.setReject('550 5.1.1 Unknown recipient');
    return;
  }

  let exists: boolean;
  try {
    exists = await accountExists(username, config);
  } catch {
    // A failed lookup must be retried, never treated as proof that the name exists.
    message.setReject('451 4.3.0 Temporary failure, please retry later');
    return;
  }
  if (!exists) {
    message.setReject('550 5.1.1 Unknown recipient');
    return;
  }

  const raw = await new Response(message.raw).arrayBuffer();
  const parsed = await PostalMime.parse(raw);

  const attachments: AttachmentMeta[] = (parsed.attachments || []).map((a) => ({
    name: sanitizeFilename(a.filename),
    type: a.mimeType || 'application/octet-stream',
    // postal-mime may give a string, ArrayBuffer or Uint8Array depending on the part.
    size: attachmentSize(a.content),
  }));

  const bodyText = truncate((parsed.text || '').trimEnd(), MAX_STORED_TEXT_CHARS);
  const bodyHtml = parsed.html ? truncate(parsed.html, MAX_STORED_HTML_CHARS) : null;
  const fromEmail = (parsed.from?.address || message.from || '').toLowerCase();

  const db = await Db.from(env);
  await insertMessage(db, {
    username,
    folder: 'inbox',
    fromEmail: fromEmail || 'unknown@invalid',
    fromName: parsed.from?.name || null,
    to: [message.to.toLowerCase()],
    toEmail: message.to.toLowerCase(),
    subject: truncate(parsed.subject || '(no subject)', MAX_SUBJECT_CHARS),
    text: bodyText || (bodyHtml ? '(HTML message)' : ''),
    html: bodyHtml,
    attachments,
    isRead: false,
    isStarred: false,
    providerId: message.headers.get('message-id') || null,
  });

  // Retention runs inline: a mailbox is never over its cap after this returns.
  // A cleanup failure must not reject a delivered message, so it is logged only.
  try {
    await enforceRetention(db, username);
  } catch {
    console.error('inbound_retention_failed');
  }
}
