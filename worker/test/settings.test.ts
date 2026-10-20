// Settings + retention over HTTP.
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
// Settings + retention over HTTP
// ---------------------------------------------------------------------------

test('GET settings returns defaults plus live storage stats', async () => {
  h.stub = fullStub;
  await seedMessage({ sizeBytes: 1200 });
  await seedMessage({ sizeBytes: 800, starred: true });

  const res = await worker.fetch(authed('/api/mail/settings'), h.env);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.retentionLimit, 500);
  assert.equal(body.storageQuotaBytes, 52_428_800);
  assert.equal(body.storageUsedBytes, 2000);
  assert.equal(body.totalMessages, 2);
  assert.equal(body.starredMessages, 1);
});

test('PATCH settings validates the limit and needs our origin', async () => {
  h.stub = fullStub;
  const invalid = await worker.fetch(authed('/api/mail/settings', writeInit('PATCH', { retentionLimit: 999 })), h.env);
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).error, 'bad_retention_limit');

  const noOrigin = await worker.fetch(
    req('/api/mail/settings', {
      method: 'PATCH',
      cookie: 'gothwad_at=good',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ retentionLimit: 1500 }),
    }),
    h.env
  );
  assert.equal(noOrigin.status, 403);
});

test('PATCH settings lowers the limit and trims immediately', async () => {
  h.stub = fullStub;
  const db = await Db.from(h.env);
  await db.run(
    "INSERT INTO mail_settings (username, retention_limit, quota_bytes, updated_at) VALUES ('alice', 0, 52428800, ?)",
    new Date().toISOString()
  );
  for (let i = 0; i < 505; i += 1) await seedMessage({ daysAgo: 600 - i, sizeBytes: 10 });
  await seedMessage({ daysAgo: 9999, starred: true, sizeBytes: 10 });

  const res = await worker.fetch(authed('/api/mail/settings', writeInit('PATCH', { retentionLimit: 500 })), h.env);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.retentionLimit, 500);
  assert.equal(body.cleanup.trimmed, 5);
  assert.equal(body.totalMessages, 501, '500 newest plus the starred one');
  assert.equal(body.starredMessages, 1);
});

test('PATCH settings to "Store All" (0) keeps everything under the quota', async () => {
  h.stub = fullStub;
  for (let i = 0; i < 5; i += 1) await seedMessage({ daysAgo: 10 + i, sizeBytes: 100 });
  const res = await worker.fetch(authed('/api/mail/settings', writeInit('PATCH', { retentionLimit: 0 })), h.env);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.retentionLimit, 0);
  assert.equal(body.totalMessages, 5);
});
