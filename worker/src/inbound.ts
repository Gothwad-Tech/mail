// =============================================================================
// Inbound mail: Cloudflare Email Routing -> this Worker's email() handler.
//
// Flow:
//   someone -> pawan@gothwadtech.com
//   -> Cloudflare Email Routing (catch-all *@APP_DOMAIN -> this Worker)
//   -> parse MIME (postal-mime)
//   -> insert one row into public.mail_messages (folder = 'inbox')
//
// Why SERVICE ROLE insert: there is no user session here. The email arrives
// from the internet. The Worker decides which mailbox it belongs to.
//
// Free-tier guards:
//   - Messages above MAX_INBOUND_BYTES are rejected (SMTP 552).
//   - Attachment BYTES are never stored. We keep only name/type/size metadata.
//   - Body text and HTML are truncated to fixed limits.
// =============================================================================

import PostalMime from 'postal-mime';
import type { Config } from './config';
import { Db } from './db';
import { makeSnippet, AttachmentMeta, MAX_STORED_HTML_CHARS } from './mail';

const MAX_STORED_TEXT_CHARS = 200_000;
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

export async function handleInbound(message: ForwardableEmailMessage, config: Config, db: Db): Promise<void> {
  const local = localPartForDomain(message.to, config.appDomain);
  if (!local) {
    message.setReject('550 5.1.1 Unknown recipient');
    return;
  }

  if (message.rawSize > config.maxInboundBytes) {
    message.setReject('552 5.3.4 Message too large');
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

  await db.insert('mail_messages', {
    to_username: local,
    user_id: null, // filled later if we ever map usernames to auth.users ids
    folder: 'inbox',
    from_email: fromEmail || 'unknown@invalid',
    from_name: parsed.from?.name || null,
    to_email: message.to.toLowerCase(),
    subject: truncate(parsed.subject || '(no subject)', MAX_SUBJECT_CHARS),
    snippet: makeSnippet(bodyText || (bodyHtml ? '(HTML message)' : '')),
    body_text: bodyText,
    body_html: bodyHtml,
    attachments,
    is_read: false,
    is_starred: false,
    provider_id: message.headers.get('message-id') || null,
  });
}
