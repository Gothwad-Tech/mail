// Inbound email from Cloudflare Email Routing.
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
// Inbound email
// ---------------------------------------------------------------------------


test('inbound email: parses MIME, stores Hindi body gzipped, drops attachment bytes', async () => {
  h.stub = fullStub;
  // The signed-in test user is alice, so mail to alice can also be opened via
  // the API below (the detail endpoint is scoped to the session user).
  await worker.email(inboundMessage('alice@gothwadtech.com').msg, h.env);

  const db = await Db.from(h.env);
  const row = await db.first<Record<string, unknown>>(
    "SELECT * FROM mail_messages WHERE to_username = 'alice' AND folder = 'inbox'"
  );
  assert.ok(row, 'row stored');
  assert.equal(row.from_email, 'ravi@example.org');
  assert.equal(row.subject, 'Invoice for October');
  assert.equal(row.provider_id, '<abc123@example.org>');
  assert.ok(row.body_gzip instanceof Uint8Array, 'the body is a gzip BLOB');
  assert.equal(row.body_text, null, 'plain columns stay empty for new rows');

  const attachments = JSON.parse(String(row.attachments)) as Array<{ name: string; type: string; size: number }>;
  assert.equal(attachments.length, 1);
  assert.equal(attachments[0].name, 'invoice.pdf');
  assert.ok(attachments[0].size > 0);
  assert.equal(JSON.stringify(row).includes('JVBERi0x'), false, 'attachment bytes are not stored');

  const detail = await (await worker.fetch(authed('/api/mail/messages/' + String(row.id)), h.env)).json();
  assert.match(detail.message.bodyText, /नमस्ते/);
  assert.match(detail.message.bodyText, /🙏/);
});

test('inbound username lookup uses AUTH_HUB_URL, not AUTH_SIGNIN_URL', async () => {
  const custom = makeEnv({ AUTH_HUB_URL: 'https://api.test', AUTH_SIGNIN_URL: 'https://accounts.test' });
  h.env = custom;
  h.stub = (s) => {
    if (s.url.origin === 'https://api.test' && s.url.pathname === '/api/internal/usernames/pawan') {
      return Response.json({ exists: true });
    }
    return new Response('x', { status: 599 });
  };
  const { msg, rejected } = inboundMessage('pawan@gothwadtech.com');
  await worker.email(msg, custom);
  assert.equal(rejected(), null);
  const lookup = h.seen.find((s) => s.url.pathname.startsWith('/api/internal/usernames/'));
  assert.equal(lookup?.url.origin, 'https://api.test');
  assert.equal(h.seen.some((s) => s.url.host === 'accounts.test'), false);
});

test('inbound sends the Accounts token only in the Authorization header', async () => {
  h.stub = fullStub;
  const { msg, rejected } = inboundMessage('Pawan@gothwadtech.com');
  await worker.email(msg, h.env);
  assert.equal(rejected(), null);
  const lookup = h.seen.find((s) => s.url.pathname === '/api/internal/usernames/pawan');
  assert.ok(lookup);
  assert.equal(lookup.headers.get('authorization'), `Bearer ${ACCOUNTS_TOKEN}`);
  assert.equal(lookup.url.search, '');
  assert.equal(lookup.url.href.includes(ACCOUNTS_TOKEN), false);
});

test('inbound email for another domain is rejected and not stored', async () => {
  h.stub = fullStub;
  const { msg, rejected } = inboundMessage('pawan@gmail.com');
  await worker.email(msg, h.env);
  assert.match(rejected() ?? '', /Unknown recipient/);
  assert.equal(h.seen.length, 0);
  assert.equal(await countRows(), 0);
});

test('inbound email over the size cap is rejected before parsing', async () => {
  h.stub = fullStub;
  const { msg, rejected } = inboundMessage('pawan@gothwadtech.com', 999_999_999);
  await worker.email(msg, h.env);
  assert.match(rejected() ?? '', /too large/);
  assert.equal(h.seen.length, 0);
});

test('inbound email to an unknown Accounts username gets 550 and is not stored', async () => {
  h.stub = fullStub;
  const { msg, rejected } = inboundMessage('nobody-here@gothwadtech.com');
  await worker.email(msg, h.env);
  assert.match(rejected() ?? '', /^550 .*Unknown recipient/);
  assert.equal(await countRows(), 0);
});

test('inbound Accounts 401 gets 451 and is not stored', async () => {
  h.stub = (s) =>
    s.url.pathname.startsWith('/api/internal/usernames/')
      ? Response.json({ error: 'unauthorized' }, { status: 401 })
      : new Response('x', { status: 599 });
  const { msg, rejected } = inboundMessage('pawan@gothwadtech.com');
  await worker.email(msg, h.env);
  assert.match(rejected() ?? '', /^451 4\.3\.0 Temporary failure/);
  assert.equal(await countRows(), 0);
});

test('inbound Accounts network failure / timeout / bad JSON gets 451', async () => {
  for (const make of [
    () => Promise.reject(new TypeError('network down')),
    () => Promise.reject(new DOMException('operation timed out', 'TimeoutError')),
    () => new Response('{not-json', { status: 200 }),
  ]) {
    h.env = makeEnv();
    h.stub = (s) =>
      s.url.pathname.startsWith('/api/internal/usernames/') ? (make() as Response) : new Response('x', { status: 599 });
    const { msg, rejected } = inboundMessage('pawan@gothwadtech.com');
    await worker.email(msg, h.env);
    assert.match(rejected() ?? '', /^451 4\.3\.0 Temporary failure/);
    assert.equal(await countRows(), 0);
  }
});

test('inbound missing Accounts token gets 451 without any request or insert', async () => {
  h.env = makeEnv({ ACCOUNTS_INTERNAL_TOKEN: undefined });
  h.stub = () => new Response('unexpected request', { status: 599 });
  const { msg, rejected } = inboundMessage('pawan@gothwadtech.com');
  await worker.email(msg, h.env);
  assert.match(rejected() ?? '', /^451 4\.3\.0 Temporary failure/);
  assert.equal(h.seen.length, 0);
  assert.equal(await countRows(), 0);
});

test('inbound name with a bad shape is rejected before any Accounts call', async () => {
  h.stub = fullStub;
  const { msg, rejected } = inboundMessage('-bad@gothwadtech.com');
  await worker.email(msg, h.env);
  assert.match(rejected() ?? '', /^550 /);
  assert.equal(h.seen.length, 0);
});

test('inbound mail triggers retention: the mailbox stays at the cap', async () => {
  h.stub = fullStub;
  for (let i = 0; i < 500; i += 1) await seedMessage({ username: 'pawan', daysAgo: 400 + i, sizeBytes: 10 });
  await worker.email(inboundMessage('pawan@gothwadtech.com').msg, h.env);
  assert.equal(await countRows("to_username = 'pawan'"), 500, 'newest 500 kept, oldest trimmed');
  const newest = await (await Db.from(h.env)).first<{ subject: string }>(
    "SELECT subject FROM mail_messages WHERE to_username = 'pawan' ORDER BY received_at DESC LIMIT 1"
  );
  assert.equal(newest?.subject, 'Invoice for October', 'the just-received mail is kept');
});
