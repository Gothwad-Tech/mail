// Sending through Resend: daily cap, Sent copy, draft cleanup.
//
// Split out of worker.test.ts so no test file grows past a few hundred
// lines; the harness in helpers.ts is shared. Run: npm run test:worker

import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker, { handleRequest } from '../src/index.ts';
import { textToHtml, cleanRecipients } from '../src/mail.ts';
import { localPartForDomain } from '../src/inbound.ts';
import { Db } from '../src/db.ts';
import {
  h,
  MAIL_ORIGIN,
  req,
  authed,
  writeInit,
  seedMessage,
  countRows,
  fullStub,
  accountsStub,
  accountsMeStub,
  hubOnlyStub,
  sessionResponse,
  inboundMessage,
  makeEnv,
  ACCOUNTS_TOKEN,
  RESEND_KEY,
  parsePatch,
  type Seen,
  type Stub,
  type Env,
} from './helpers.ts';

// ---------------------------------------------------------------------------
// Send (Resend h.stub)
// ---------------------------------------------------------------------------

test('send without a Resend key returns a clear 503 and sends nothing', async () => {
  h.stub = fullStub;
  h.env = makeEnv({ RESEND_API_KEY: undefined });
  const res = await worker.fetch(
    authed('/api/mail/send', writeInit('POST', { to: ['bob@example.com'], subject: 'Hi', body: 'Hello' })),
    h.env
  );
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error, 'sending_not_configured');
  assert.equal(h.seen.filter((s) => s.url.host === 'api.resend.com').length, 0);
});

test('send uses username@APP_DOMAIN, saves a gzipped Sent copy and removes the draft', async () => {
  h.stub = fullStub;
  const draftId = await seedMessage({ folder: 'drafts' });

  const res = await worker.fetch(
    authed(
      '/api/mail/send',
      writeInit('POST', {
        to: ['Bob@Example.com'],
        cc: ['carol@example.com'],
        subject: 'Hi\r\nBcc: evil@x.com',
        body: 'Hello <b>there</b>',
        draftId,
      })
    ),
    h.env
  );
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.sent, true);
  assert.equal(body.saved, true);
  assert.equal(body.remainingToday, 1);

  const resend = h.seen.find((s) => s.url.host === 'api.resend.com');
  const payload = JSON.parse(resend?.body || '{}');
  assert.equal(payload.from, 'alice@gothwadtech.com');
  assert.deepEqual(payload.to, ['bob@example.com']);
  assert.deepEqual(payload.cc, ['carol@example.com']);
  assert.equal(payload.subject.includes('\n'), false, 'no header injection via subject');
  assert.equal(payload.html.includes('<b>'), false, 'user text is HTML-escaped');
  assert.equal(resend?.headers.get('authorization'), `Bearer ${RESEND_KEY}`);
  assert.equal(resend?.url.href.includes(RESEND_KEY), false, 'the key never goes in a URL');

  assert.equal(await countRows("folder = 'sent' AND is_read = 1"), 1, 'a Sent copy exists');
  assert.equal(await countRows('id = ?', draftId), 0, 'the draft is cleaned up');

  const detail = await (await worker.fetch(authed(`/api/mail/messages/${body.id}`), h.env)).json();
  assert.equal(detail.message.folder, 'sent');
  assert.equal(detail.message.bodyText, 'Hello <b>there</b>');
});

test('send stops at the daily limit with 429 and does not call Resend', async () => {
  h.stub = fullStub;
  h.env = makeEnv({ DAILY_SEND_LIMIT: '1' });
  await seedMessage({ folder: 'sent', daysAgo: 0 });

  const res = await worker.fetch(
    authed('/api/mail/send', writeInit('POST', { to: ['bob@example.com'], subject: 'Hi', body: 'Hello' })),
    h.env
  );
  assert.equal(res.status, 429);
  assert.equal((await res.json()).error, 'daily_limit');
  assert.equal(h.seen.filter((s) => s.url.host === 'api.resend.com').length, 0);
});

test('send validates recipients and refuses an empty recipient list', async () => {
  h.stub = fullStub;
  const empty = await worker.fetch(
    authed('/api/mail/send', writeInit('POST', { to: [], subject: 'Hi', body: 'x' })),
    h.env
  );
  assert.equal(empty.status, 400);
  assert.equal((await empty.json()).error, 'no_recipients');

  const bad = await worker.fetch(
    authed('/api/mail/send', writeInit('POST', { to: ['not-an-email'], subject: 'Hi', body: 'x' })),
    h.env
  );
  assert.equal(bad.status, 400);
  assert.equal(h.seen.filter((s) => s.url.host === 'api.resend.com').length, 0);
});
