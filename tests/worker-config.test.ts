// =============================================================================
// Guard for worker/wrangler.toml. Runs with: npm run test:config
//
// Why this exists: a deploy from the dashboard/Git used to wipe the Worker's
// plain-text variables, so the API answered "not configured". These checks keep
// the committed file complete (every public var filled in), keep the Cloudflare
// D1 `mail` binding in place, and keep every secret out of the file. Names only
// - never a value. Gothwad Mail is 100% Cloudflare native (zero Supabase).
// =============================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const TOML_PATH = fileURLToPath(new URL('../worker/wrangler.toml', import.meta.url));
const RAW = readFileSync(TOML_PATH, 'utf8');

/** Comment- and blank-free view of the file. */
const LINES = RAW.split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line.length > 0 && !line.startsWith('#'));

const TOP_LEVEL = LINES.filter((line) => !line.startsWith('['));

interface VarValue {
  key: string;
  value: string;
  comment: string | null;
}

/** Simple `KEY = "value" # comment` reader for the sections this file uses. */
function readSection(name: string): Map<string, VarValue> {
  const out = new Map<string, VarValue>();
  let current = '';
  for (const line of LINES) {
    const section = line.match(/^\[([^\]]+)\]$/);
    if (section) {
      current = section[1];
      continue;
    }
    if (current !== name) continue;
    // Inline comments are fine because no value here contains '#'. A '#' inside
    // a quoted value would break this, so the check below also proves it does not.
    const [code, ...rest] = line.split('#');
    const match = code.trim().match(/^([A-Z0-9_]+)\s*=\s*"([^"]*)"\s*$/);
    assert.ok(match, `worker/wrangler.toml: [${name}] has an unparsable line: ${line}`);
    out.set(match[1], {
      key: match[1],
      value: match[2],
      comment: rest.length > 0 ? rest.join('#').trim() : null,
    });
  }
  return out;
}

const vars = readSection('vars');

/** Public vars the Worker reads. A missing one used to mean a broken deploy. */
const REQUIRED_PUBLIC_VARS = [
  'APP_DOMAIN',
  'AUTH_HUB_URL',
  'AUTH_SIGNIN_URL',
  'MAIL_URL',
  'ENVIRONMENT',
  'DAILY_SEND_LIMIT',
  'MAX_INBOUND_BYTES',
];

// Only two Worker secrets remain after the D1 migration.
const SECRET_VARS = ['ACCOUNTS_INTERNAL_TOKEN', 'RESEND_API_KEY'];

function value(key: string): string {
  const entry = vars.get(key);
  assert.ok(entry, `worker/wrangler.toml [vars] is missing ${key}`);
  return entry.value;
}

test('wrangler.toml keeps dashboard variables on deploy', () => {
  assert.match(
    RAW,
    /^keep_vars\s*=\s*true\s*$/m,
    'keep_vars = true is missing: a deploy would delete dashboard-only variables',
  );
  assert.ok(
    TOP_LEVEL.some((line) => line.startsWith('name') || line.startsWith('main')),
    'top-level Worker keys are missing from wrangler.toml',
  );
});

test('every public var the Worker needs is filled in the file', () => {
  for (const key of REQUIRED_PUBLIC_VARS) {
    const raw = value(key);
    assert.notEqual(raw.trim(), '', `[vars] ${key} is blank`);
  }
});

test('the Cloudflare D1 binding points at the `mail` database', () => {
  // Exactly one binding, named DB. A wrong database_name or id silently points
  // the Worker at another database (or a non-existent one).
  const d1Block = RAW.match(/\[\[d1_databases\]\]([\s\S]*?)(?=\n\[|$)/);
  assert.ok(d1Block, 'wrangler.toml has no [[d1_databases]] block');
  const block = d1Block[1];
  assert.match(block, /^\s*binding\s*=\s*"DB"\s*$/m, 'the binding must be DB');
  assert.match(block, /^\s*database_name\s*=\s*"mail"\s*$/m, 'the database must be named mail');
  const id = block.match(/^\s*database_id\s*=\s*"([^"]+)"\s*$/m)?.[1];
  assert.ok(id, 'database_id is missing');
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'database_id must be a UUID');
  assert.doesNotMatch(block, /REPLACE_ME|PASTE|YOUR_|example/i, 'database_id is still a placeholder');
});

test('the config is 100% Cloudflare native: no Supabase URL or key names', () => {
  // Comments may explain the migration; actual settings may not contain it.
  const code = LINES.join('\n');
  assert.doesNotMatch(code, /SUPABASE/i, 'SUPABASE_* must not appear in wrangler.toml');
  assert.doesNotMatch(code, /supabase\.co/i, 'no Supabase project URL may remain');
});

test('the Accounts hosts stay split: server calls vs browser links', () => {
  const hub = value('AUTH_HUB_URL');
  const signin = value('AUTH_SIGNIN_URL');
  // Known failure: the Pages host answers HTML to a server-to-server call.
  assert.notEqual(
    hub,
    'https://accounts.gothwadtech.com',
    'AUTH_HUB_URL must not be the Accounts Pages host (503 accounts_unexpected_response)',
  );
  assert.match(hub, /^https:\/\/[a-z0-9.-]+$/i, `AUTH_HUB_URL looks wrong: "${hub}"`);
  assert.match(signin, /^https:\/\/[a-z0-9.-]+$/i, `AUTH_SIGNIN_URL looks wrong: "${signin}"`);
});

test('no secret names are declared in the file', () => {
  for (const line of LINES) {
    for (const secret of SECRET_VARS) {
      assert.doesNotMatch(
        line,
        new RegExp(`^\\[?\\s*${secret}\\b`),
        `${secret} must never be declared in wrangler.toml`,
      );
    }
  }
});

test('the file carries no key-shaped or token-shaped values', () => {
  // Comments are allowed to name the secret placeholders; code is not.
  const code = LINES.join('\n');
  // Supabase secret keys, Resend keys, JWTs, and long opaque secrets.
  const patterns: Array<[RegExp, string]> = [
    [/sb_secret_[A-Za-z0-9_-]+/, 'a Supabase secret key'],
    [/sbp_[A-Za-z0-9_-]+/, 'a Supabase access token'],
    [/re_[A-Za-z0-9_-]{8,}/, 'a Resend API key'],
    [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, 'a JWT'],
    [/service_role/, 'a service_role string'],
  ];
  for (const [pattern, label] of patterns) {
    assert.doesNotMatch(code, pattern, `worker/wrangler.toml looks like it contains ${label}`);
  }
});

test('var values are short, plain values (no accidental multi-line secret)', () => {
  for (const entry of vars.values()) {
    assert.ok(
      entry.value.length <= 256,
      `[vars] ${entry.key} is suspiciously long (${entry.value.length} chars) - is a secret pasted here?`,
    );
    assert.doesNotMatch(entry.value, /\s/, `[vars] ${entry.key} contains whitespace`);
  }
});

test('secret names are documented in the header comment', () => {
  for (const secret of SECRET_VARS) {
    assert.match(
      RAW,
      new RegExp(`^#.*\\b${secret}\\b`, 'm'),
      `${secret} is not documented in the wrangler.toml header`,
    );
  }
});
