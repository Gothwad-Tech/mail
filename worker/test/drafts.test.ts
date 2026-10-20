// Draft autosave: gzip body, update in place, delete.
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
// Drafts
// ---------------------------------------------------------------------------

test('drafts are created with a gzip body, updated in place, then deleted', async () => {
  h.stub = fullStub;
  const created = await worker.fetch(
    authed(
      '/api/mail/drafts',
      writeInit('POST', { to: ['bob@example.com'], cc: [], bcc: [], subject: 'Draft 1', body: 'नमस्ते 🙏' })
    ),
    h.env
  );
  assert.equal(created.status, 200);
  const draft = (await created.json()).message;
  assert.equal(draft.folder, 'drafts');
  assert.equal(draft.bodyText, 'नमस्ते 🙏');

  const updated = await worker.fetch(
    authed(
      '/api/mail/drafts',
      writeInit('POST', { id: draft.id, to: ['bob@example.com'], cc: [], bcc: [], subject: 'Draft 2', body: 'updated' })
    ),
    h.env
  );
  assert.equal(updated.status, 200);
  assert.equal((await updated.json()).message.id, draft.id, 'the same draft id is kept');
  assert.equal(await countRows("folder = 'drafts'"), 1, 'no duplicate draft was created');

  const removed = await worker.fetch(authed(`/api/mail/drafts/${draft.id}`, writeInit('DELETE', {})), h.env);
  assert.equal(removed.status, 200);
  assert.equal(await countRows("folder = 'drafts'"), 0);
});
