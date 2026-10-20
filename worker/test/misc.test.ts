// CORS, unknown routes and pure helpers.
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
// Misc
// ---------------------------------------------------------------------------

test('CORS: only allowlisted origins get Allow-Origin', async () => {
  h.stub = fullStub;
  const ok = await worker.fetch(req('/api/health', { origin: MAIL_ORIGIN }), h.env);
  assert.equal(ok.headers.get('access-control-allow-origin'), MAIL_ORIGIN);
  const bad = await worker.fetch(req('/api/health', { origin: 'https://evil.example' }), h.env);
  assert.equal(bad.headers.get('access-control-allow-origin'), null);
});

test('unknown API paths return JSON 404', async () => {
  const res = await worker.fetch(req('/api/nope'), h.env);
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, 'not_found');
});

test('textToHtml escapes markup and keeps line breaks', () => {
  assert.equal(textToHtml('a <b>\nc'), 'a &lt;b&gt;<br>c');
  assert.throws(() => cleanRecipients('x', 'to'), /must be a list/);
  assert.deepEqual(cleanRecipients(['A@B.com', 'a@b.com'], 'to'), ['a@b.com']);
});

test('inbound routing only accepts our APP_DOMAIN, case-insensitive', () => {
  assert.equal(localPartForDomain('Pawan@GothwadTech.com', 'gothwadtech.com'), 'pawan');
  assert.equal(localPartForDomain('pawan@gmail.com', 'gothwadtech.com'), null);
  assert.equal(localPartForDomain('no-at-sign', 'gothwadtech.com'), null);
});
