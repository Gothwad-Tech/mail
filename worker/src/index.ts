// =============================================================================
// Gothwad Mail Worker: one Worker with two entry points.
//
//   fetch()  -> REST API under /api/* (route: mail.gothwadtech.com/api/*)
//   email()  -> inbound mail from Cloudflare Email Routing (catch-all)
//
// Endpoints (all JSON, all need a signed-in Accounts session except /api/health):
//   GET    /api/health
//   GET    /api/session
//   GET    /api/mail/messages?folder=inbox|starred|sent|drafts|trash&limit=&before=
//   GET    /api/mail/messages/:id
//   PATCH  /api/mail/messages/:id          { isRead?, isStarred?, moveToTrash? }
//   DELETE /api/mail/messages/:id          only for items already in Trash
//   POST   /api/mail/drafts                { id?, to, cc, bcc, subject, body }
//   DELETE /api/mail/drafts/:id
//   POST   /api/mail/send                  { to, cc?, bcc?, subject, body, draftId? }
// =============================================================================

import { readConfig, isSupabaseConfigured, type Config, type Env } from './config';
import { Db } from './db';
import { corsHeaders, errorResponse, HttpError, json, assertSafeWrite, readJson } from './http';
import * as mail from './mail';
import { handleInbound } from './inbound';
import { resolveSession, signinBaseUrl, deriveEmail, takeUpstreamCookies, type Session } from './session';
import { sendViaResend } from './resend';

async function requireSession(request: Request, config: Config): Promise<Session> {
  const session = await resolveSession(request, config);
  if (!session) {
    // The browser uses signinUrl to send the user to Accounts (then back to Mail).
    throw new HttpError(401, 'unauthenticated', 'Please sign in.', { signinUrl: signinBaseUrl(config) });
  }
  return session;
}

async function handleSession(request: Request, env: Env, config: Config): Promise<Response> {
  const session = await requireSession(request, config);

  // The remaining-today count is nice to have. If the DB is down, the session still works.
  let sendRemainingToday: number | null = null;
  try {
    const sent = await mail.countSentToday(Db.from(env, config), session.username);
    sendRemainingToday = Math.max(config.dailySendLimit - sent, 0);
  } catch {
    sendRemainingToday = null;
  }

  return json({
    authenticated: true,
    user: { username: session.username, email: session.email, name: session.name },
    accountUrl: `${config.authHubUrl}/me`,
    limits: { dailySendLimit: config.dailySendLimit, sendRemainingToday },
  });
}

async function handleSend(request: Request, env: Env, config: Config, session: Session): Promise<Response> {
  assertSafeWrite(request, config);
  const body = await readJson<Record<string, unknown>>(request, 512 * 1024);

  const to = mail.cleanRecipients(body.to, 'to');
  if (to.length === 0) throw new HttpError(400, 'no_recipients', 'Add at least one recipient.');
  const cc = mail.cleanRecipients(body.cc, 'cc');
  const bcc = mail.cleanRecipients(body.bcc, 'bcc');
  mail.checkRecipientCount(to, cc, bcc);
  const subject = mail.cleanSubject(body.subject);
  const text = mail.cleanBody(body.body);
  const draftId = body.draftId ? mail.parseId(String(body.draftId)) : null;

  // Fail clearly when the provider key is not set yet (see docs/SETUP.md).
  if (!env.RESEND_API_KEY) {
    throw new HttpError(503, 'sending_not_configured', 'Sending is not set up yet. Ask the admin to add the Resend key.');
  }
  if (!isSupabaseConfigured(config)) {
    throw new HttpError(503, 'not_configured', 'Database is not configured for this Worker.');
  }

  const db = Db.from(env, config);
  const sentToday = await mail.countSentToday(db, session.username);
  if (sentToday >= config.dailySendLimit) {
    throw new HttpError(429, 'daily_limit', `Daily send limit reached (${config.dailySendLimit} per day).`, {
      limit: config.dailySendLimit,
      remaining: 0,
    });
  }

  const from = deriveEmail(session.username, config.appDomain);
  const providerId = await sendViaResend(env.RESEND_API_KEY, {
    from,
    to,
    cc,
    bcc,
    subject,
    text,
    html: mail.textToHtml(text),
  });

  // The mail has left at this point. If saving the copy fails, we still tell
  // the user it was sent, and log the failure (no body content in logs).
  let savedId: string | null = null;
  try {
    const row = await db.insert<mail.MailRow>('mail_messages', {
      to_username: session.username,
      user_id: null,
      folder: 'sent',
      from_email: from,
      from_name: session.name,
      to_email: to.join(', '),
      cc_emails: cc,
      bcc_emails: bcc,
      subject,
      snippet: mail.makeSnippet(text),
      body_text: text,
      body_html: mail.textToHtml(text),
      attachments: [],
      is_read: true,
      is_starred: false,
      provider_id: providerId || null,
    });
    savedId = row.id;
  } catch {
    console.error('sent_copy_not_saved');
  }

  if (draftId) {
    try {
      await mail.deleteDraft(db, session.username, draftId);
    } catch {
      console.error('draft_cleanup_failed');
    }
  }

  return json(
    {
      id: savedId,
      sent: true,
      saved: savedId !== null,
      remainingToday: Math.max(config.dailySendLimit - sentToday - 1, 0),
    },
    201
  );
}

async function route(request: Request, env: Env, config: Config): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = request.method;

  if (!path.startsWith('/api/')) {
    return json({ error: 'not_found' }, 404);
  }

  if (path === '/api/health' && method === 'GET') {
    return json({ ok: true, service: 'gothwad-mail-api', environment: config.isProduction ? 'production' : 'development' });
  }

  if (path === '/api/session' && method === 'GET') {
    return handleSession(request, env, config);
  }

  if (path === '/api/mail/messages' && method === 'GET') {
    const session = await requireSession(request, config);
    const opts = mail.parseListOptions(url);
    const messages = await mail.listMessages(Db.from(env, config), session.username, opts);
    return json({ messages, folder: opts.folder, nextBefore: messages.length === opts.limit ? messages[messages.length - 1].receivedAt : null });
  }

  if (path === '/api/mail/send' && method === 'POST') {
    const session = await requireSession(request, config);
    return handleSend(request, env, config, session);
  }

  if (path === '/api/mail/drafts' && method === 'POST') {
    const session = await requireSession(request, config);
    assertSafeWrite(request, config);
    const draft = mail.parseDraft(await readJson(request, 512 * 1024));
    const message = await mail.saveDraft(
      Db.from(env, config),
      session.username,
      session.email,
      session.name,
      draft
    );
    return json({ message });
  }

  const idMatch = path.match(/^\/api\/mail\/(messages|drafts)\/([^/]+)$/);
  if (idMatch) {
    const [, kind, rawId] = idMatch;
    // decodeURIComponent throws on a bad % sequence (e.g. /%E0%A4%A). Turn that
    // into a clean 400 instead of letting it become a 500.
    let decodedId: string;
    try {
      decodedId = decodeURIComponent(rawId);
    } catch {
      throw new HttpError(400, 'bad_request', 'Malformed message id.');
    }
    const id = mail.parseId(decodedId);
    const session = await requireSession(request, config);

    if (kind === 'messages' && method === 'GET') {
      const message = await mail.getMessage(Db.from(env, config), session.username, id);
      return json({ message });
    }

    if (kind === 'messages' && method === 'PATCH') {
      assertSafeWrite(request, config);
      const patch = mail.parsePatch(await readJson(request));
      const message = await mail.patchMessage(Db.from(env, config), session.username, id, patch);
      return json({ message });
    }

    if (kind === 'messages' && method === 'DELETE') {
      assertSafeWrite(request, config);
      await mail.deleteTrashed(Db.from(env, config), session.username, id);
      return json({ ok: true });
    }

    if (kind === 'drafts' && method === 'DELETE') {
      assertSafeWrite(request, config);
      await mail.deleteDraft(Db.from(env, config), session.username, id);
      return json({ ok: true });
    }
  }

  return json({ error: 'not_found' }, 404);
}

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const config = readConfig(env);
  const cors = corsHeaders(request.headers.get('origin'), config);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  let response: Response;
  try {
    response = await route(request, env, config);
  } catch (err) {
    response = errorResponse(err, config);
  }

  for (const [key, value] of Object.entries(cors)) {
    response.headers.set(key, value);
  }
  // Pass on any rotated Accounts cookies (see session.ts). Done after errors too.
  for (const cookie of takeUpstreamCookies(request)) {
    response.headers.append('set-cookie', cookie);
  }
  return response;
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env);
  },

  async email(message: ForwardableEmailMessage, env: Env): Promise<void> {
    const config = readConfig(env);
    await handleInbound(message, config, env);
  },
} satisfies ExportedHandler<Env>;
