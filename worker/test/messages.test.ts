// Mailbox listing and message detail, including the ETag/304 path.
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
// Mailbox listing / detail
// ---------------------------------------------------------------------------

test('list only returns the session user’s mail, newest first', async () => {
  h.stub = fullStub;
  await seedMessage({ subject: 'old', daysAgo: 3 });
  await seedMessage({ subject: 'new', daysAgo: 0 });
  await seedMessage({ subject: 'bob-mail', username: 'bob' });

  const res = await worker.fetch(authed('/api/mail/messages?folder=inbox'), h.env);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(
    body.messages.map((m: { subject: string }) => m.subject),
    ['new', 'old']
  );
  assert.equal(body.folder, 'inbox');
});

test('pagination uses before= and returns nextBefore', async () => {
  h.stub = fullStub;
  for (let i = 0; i < 60; i += 1) await seedMessage({ subject: `m${i}`, daysAgo: 100 - i });

  const first = await (await worker.fetch(authed('/api/mail/messages?folder=inbox&limit=50'), h.env)).json();
  assert.equal(first.messages.length, 50);
  assert.ok(first.nextBefore);

  const second = await (
    await worker.fetch(authed(`/api/mail/messages?folder=inbox&limit=50&before=${encodeURIComponent(first.nextBefore)}`), h.env)
  ).json();
  assert.equal(second.messages.length, 10);
  assert.equal(new Set([...first.messages, ...second.messages].map((m: { id: string }) => m.id)).size, 60);
});

test('starred view excludes trash and unstarred mail', async () => {
  h.stub = fullStub;
  await seedMessage({ subject: 'star-inbox', starred: true });
  await seedMessage({ subject: 'star-sent', starred: true, folder: 'sent' });
  await seedMessage({ subject: 'star-trash', starred: true, folder: 'trash' });
  await seedMessage({ subject: 'plain' });

  const body = await (await worker.fetch(authed('/api/mail/messages?folder=starred'), h.env)).json();
  assert.deepEqual(body.messages.map((m: { subject: string }) => m.subject).sort(), ['star-inbox', 'star-sent']);
});

test('detail decompresses Hindi/emoji bodies; the list never carries bodies', async () => {
  h.stub = fullStub;
  const text = 'नमस्ते 🙏 यह ईमेल gzip में सुरक्षित है ✅';
  const html = `<html><body><h1>समाचार 📰</h1>${'<p>नमस्ते दुनिया</p>'.repeat(2000)}</body></html>`;
  const id = await seedMessage({ subject: 'Unicode', text, html });

  const list = await (await worker.fetch(authed('/api/mail/messages?folder=inbox'), h.env)).json();
  assert.equal('bodyText' in list.messages[0], false, 'list stays light');
  assert.equal('bodyHtml' in list.messages[0], false);

  const detail = await (await worker.fetch(authed(`/api/mail/messages/${id}`), h.env)).json();
  assert.equal(detail.message.bodyText, text);
  assert.equal(detail.message.bodyHtml, html);
});

test('GET detail sends an ETag and answers 304 without decompressing on revalidation', async () => {
  h.stub = fullStub;
  const id = await seedMessage({ subject: 'Cached', text: 'hello', html: '<p>hello</p>' });

  const first = await worker.fetch(authed(`/api/mail/messages/${id}`), h.env);
  assert.equal(first.status, 200);
  const etag = first.headers.get('etag');
  assert.ok(etag, 'the detail response carries a validator');
  assert.doesNotMatch(etag!, /undefined|NaN/, 'the tag is built from real stored values');
  assert.match(first.headers.get('cache-control') || '', /private/);
  assert.equal((await first.json()).message.bodyText, 'hello');

  const second = await worker.fetch(
    authed(`/api/mail/messages/${id}`, { headers: { 'if-none-match': etag! } }),
    h.env
  );
  assert.equal(second.status, 304);
  assert.equal(await second.text(), '', 'a 304 has no body');

  // A write changes the row, so the old tag must stop matching.
  await worker.fetch(authed(`/api/mail/messages/${id}`, writeInit('PATCH', { isStarred: true })), h.env);
  const third = await worker.fetch(
    authed(`/api/mail/messages/${id}`, { headers: { 'if-none-match': etag! } }),
    h.env
  );
  assert.equal(third.status, 200, 'stale tag revalidates to a fresh body');
  assert.equal((await third.json()).message.isStarred, true);
});

test('a message from another mailbox is a 404', async () => {
  h.stub = fullStub;
  const bobId = await seedMessage({ username: 'bob' });
  const res = await worker.fetch(authed(`/api/mail/messages/${bobId}`), h.env);
  assert.equal(res.status, 404);
});

test('bad folder and bad id are rejected before the database is touched', async () => {
  h.stub = fullStub;
  const bad = await worker.fetch(authed('/api/mail/messages?folder=spam'), h.env);
  assert.equal(bad.status, 400);
  const badId = await worker.fetch(authed('/api/mail/messages/not-a-uuid'), h.env);
  assert.equal(badId.status, 400);
});

test('malformed percent-encoding in a message id is a 400, not a 500', async () => {
  h.stub = fullStub;
  const res = await handleRequest(req('/api/mail/messages/%E0%A4%A', { cookie: 'gothwad_at=good' }), h.env);
  assert.equal(res.status, 400);
  assert.equal(((await res.json()) as { error: string }).error, 'bad_request');
});
