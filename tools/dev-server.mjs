/**
 * =============================================================================
 * LOCAL FULL-STACK PREVIEW SERVER (`npm run preview:api`)
 * =============================================================================
 * WHY: production me `env.DB` Cloudflare D1 hota hai. Local preview me hum
 * ASLI SQLite (node:sqlite) ko D1 jaisa adapter dete hain, aur wahi Worker
 * (`worker/src/index.ts`) chalate hain jo production me chalta hai - koi
 * duplicate Express/server.js nahi.
 *
 *   browser (Vite :3000) --/api--> yeh server (:8787) --> LocalD1 (SQLite)
 *
 * Auth: preview browser ke paas Accounts cookie nahi hoti, isliye Worker ka
 * dev-only bypass (`DEV_AUTH_USERNAME`) use hota hai. Lekin agar request ke
 * saath `gothwad_*` cookie aaye (UI smoke test aise karta hai), to yeh server
 * ek LOCAL Accounts stub ki tarah answer karta hai - 401 / 503 branches bhi
 * isliye test ho sakti hain. Resend ka call bhi local me fake hota hai.
 * Koi real email kabhi nahi jata aur koi real key nahi chahiye.
 * =============================================================================
 */

import http from 'node:http';
import process from 'node:process';
import { createLocalD1 } from './local-d1.mjs';
import worker from '../worker/src/index.ts';
import { Db } from '../worker/src/db.ts';
import { insertMessage } from '../worker/src/mail.ts';
import { getSettings } from '../worker/src/retention.ts';

const PORT = Number(process.env.PREVIEW_API_PORT || 8787);
const USERNAME = (process.env.DEV_AUTH_USERNAME || 'pawan').toLowerCase();

const db = createLocalD1(process.env.DEV_D1_FILE || ':memory:');

const env = {
  DB: db,
  APP_DOMAIN: process.env.APP_DOMAIN || 'gothwadtech.com',
  AUTH_HUB_URL: process.env.AUTH_HUB_URL || 'https://api.gothwadtech.com',
  AUTH_SIGNIN_URL: process.env.AUTH_SIGNIN_URL || 'https://accounts.gothwadtech.com',
  MAIL_URL: process.env.MAIL_URL || 'http://localhost:3000',
  ENVIRONMENT: 'development',
  DEV_AUTH_USERNAME: USERNAME,
  RESEND_API_KEY: 're_local_preview_only',
  ALLOWED_ORIGINS:
    'http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173,http://127.0.0.1:5173',
  DAILY_SEND_LIMIT: '30',
  MAX_INBOUND_BYTES: '10485760',
};

// Local only: a two-account Accounts stub, so the Google-style switcher is
// testable without the real Accounts service. The active account is a cookie
// (`gothwad_active`), exactly like the contract in docs/ACCOUNTS_AGENT_PROMPT.md,
// so a switch survives a reload and the rest of the Worker code is untouched.
const LOCAL_ACCOUNTS = [
  { id: 'a', username: 'alice', firstName: 'Alice', lastName: 'Sharma' },
  { id: 'b', username: 'bob', firstName: 'Bob', lastName: 'Verma' },
];

function activeSlot(cookie) {
  const match = /gothwad_active=([a-z])/.exec(cookie || '');
  const id = match && match[1];
  return LOCAL_ACCOUNTS.some((a) => a.id === id) ? id : 'a';
}

function accountsBody(activeId, slotIds) {
  return {
    activeId,
    accounts: LOCAL_ACCOUNTS.filter((a) => slotIds.includes(a.id)).map((a) => ({
      id: a.id,
      username: a.username,
      firstName: a.firstName,
      lastName: a.lastName,
      lastUsedAt: new Date().toISOString(),
    })),
  };
}

function accountsResponse(activeId, slotIds = LOCAL_ACCOUNTS.map((a) => a.id)) {
  const res = Response.json(accountsBody(activeId, slotIds));
  res.headers.append(
    'set-cookie',
    `gothwad_active=${activeId}; Path=/; SameSite=Lax`
  );
  return res;
}

// Local only: pretend Resend accepted the mail, and answer Accounts' session
// endpoints locally so the signed-out / broken-session branches are testable.
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith('https://api.resend.com/')) {
    return Response.json({ id: `local_${Date.now()}` }, { status: 200 });
  }
  if (url.startsWith(`${env.AUTH_HUB_URL}/api/auth/me`)) {
    const cookie = new Headers(init?.headers).get('cookie') || '';
    if (cookie.includes('gothwad_at=good')) {
      const slot = LOCAL_ACCOUNTS.find((a) => a.id === activeSlot(cookie)) || LOCAL_ACCOUNTS[0];
      return Response.json({
        authenticated: true,
        user: { username: slot.username, first_name: slot.firstName, last_name: slot.lastName },
      });
    }
    if (cookie.includes('gothwad_at=no_username')) {
      return Response.json({ authenticated: true, user: { username: '' } });
    }
    return Response.json({ authenticated: false }, { status: 401 });
  }
  if (url.startsWith(`${env.AUTH_HUB_URL}/api/auth/accounts/`)) {
    // POST /api/auth/accounts/:id/signout — drop that slot from the list.
    const cookie = new Headers(init?.headers).get('cookie') || '';
    const id = url.split('/api/auth/accounts/')[1].split('/')[0];
    const remaining = LOCAL_ACCOUNTS.map((a) => a.id).filter((slot) => slot !== id);
    const next = remaining.includes(activeSlot(cookie)) ? activeSlot(cookie) : remaining[0];
    return accountsResponse(next || 'a', remaining);
  }
  if (url.startsWith(`${env.AUTH_HUB_URL}/api/auth/accounts`)) {
    const cookie = new Headers(init?.headers).get('cookie') || '';
    return accountsResponse(activeSlot(cookie));
  }
  if (url.startsWith(`${env.AUTH_HUB_URL}/api/auth/switch`)) {
    let id = 'a';
    try {
      id = JSON.parse(String(init?.body || '{}')).id || 'a';
    } catch {
      id = 'a';
    }
    if (!LOCAL_ACCOUNTS.some((a) => a.id === id)) {
      return Response.json({ error: 'account_not_signed_in' }, { status: 409 });
    }
    return accountsResponse(id);
  }
  if (url.startsWith(`${env.AUTH_HUB_URL}/api/oauth/userinfo`)) {
    return Response.json({ sub: '1', preferred_username: 'alice', name: 'Alice' });
  }
  if (url.startsWith(`${env.AUTH_HUB_URL}/api/internal/usernames/`)) {
    return Response.json({ exists: true });
  }
  return realFetch(input, init);
};

/** Seeds a small, clearly-labelled local mailbox so the UI has something to show. */
async function seed() {
  const mailDb = await Db.from(env);
  // `pawan` = browser preview (dev bypass). `alice` = the user the UI smoke
  // test's local Accounts stub signs in as.
  for (const username of [USERNAME, 'alice', 'bob']) await seedMailbox(mailDb, username);
}

async function seedMailbox(mailDb, username) {
  await getSettings(mailDb, username);
  const count = await mailDb.first('SELECT COUNT(*) AS n FROM mail_messages WHERE to_username = ?', username);
  if (Number(count?.n ?? 0) > 0) return;

  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const welcome = [
    {
      subject: 'Welcome to Gothwad Mail (local preview)',
      fromEmail: 'team@gothwadtech.com',
      fromName: 'Gothwad Team',
      text: 'Namaste! Yeh ek local preview hai. D1 SQLite asli hai, data sirf aapke browser session ke liye hai.\nSettings me jaakar retention 500 / 1500 / Store All test karein.',
      html: '<h2>Namaste! 🙏</h2><p>Yeh <b>local preview</b> hai. Mail bodies gzip hokar D1 (SQLite) me store hoti hain.</p>',
      isStarred: true,
      ageDays: 1,
    },
    {
      subject: 'Invoice for October',
      fromEmail: 'billing@example.org',
      fromName: 'Example Billing',
      text: 'कृपया अक्टूबर का इनवॉइस देखें। धन्यवाद 🙏',
      html: '<p>कृपया <b>अक्टूबर</b> का इनवॉइस देखें। धन्यवाद 🙏</p>',
      isStarred: false,
      ageDays: 3,
    },
    {
      subject: 'Deploy report ✅',
      fromEmail: 'ci@example.org',
      fromName: 'CI Bot',
      text: 'Build #218 passed. All 42 checks green.',
      html: '<p>Build <b>#218</b> passed ✅</p>',
      isStarred: false,
      ageDays: 6,
    },
    {
      subject: 'Old newsletter (already in Trash)',
      fromEmail: 'news@example.org',
      fromName: 'Newsletter',
      text: 'This one sits in Trash and is older than 30 days, so retention will purge it.',
      html: '<p>Old newsletter.</p>',
      isStarred: false,
      ageDays: 45,
      folder: 'trash',
    },
  ];

  for (const item of welcome) {
    await insertMessage(mailDb, {
      username,
      folder: item.folder || 'inbox',
      fromEmail: item.fromEmail,
      fromName: item.fromName,
      to: [`${username}@${env.APP_DOMAIN}`],
      subject: item.subject,
      text: item.text,
      html: item.html,
      isRead: false,
      isStarred: item.isStarred,
      providerId: null,
      receivedAt: new Date(now - item.ageDays * day).toISOString(),
    });
  }

  // One sent mail, so the Sent folder is not empty.
  await insertMessage(mailDb, {
    username,
    folder: 'sent',
    fromEmail: `${username}@${env.APP_DOMAIN}`,
    fromName: 'Pawan',
    to: ['hello@example.com'],
    subject: 'Testing Gothwad Mail',
    text: 'Hi! Yeh mail local preview se bheja gaya hai (Resend fake).',
    html: '<p>Hi! Yeh mail local preview se bheja gaya hai.</p>',
    isRead: true,
    providerId: 'local_seed',
    receivedAt: new Date(now - 2 * day).toISOString(),
  });
}

await seed();

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const body = ['GET', 'HEAD'].includes(req.method) ? undefined : await readBody(req);
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (Array.isArray(value)) for (const v of value) headers.append(key, v);
      else if (value !== undefined) headers.set(key, value);
    }
    // The browser's Origin is the preview host; the Worker only allowlists
    // localhost in development, so normalise it here (dev-only file).
    if (headers.get('origin') && !headers.get('origin').includes('localhost')) {
      headers.set('origin', 'http://localhost:3000');
    }

    const url = `http://localhost:${PORT}${req.url}`;
    const request = new Request(url, {
      method: req.method,
      headers,
      body: body && body.length > 0 ? body : undefined,
    });

    // A request that carries any cookie is decided by the local Accounts stub
    // above (so the signed-out branches are testable); everything else (the
    // plain browser preview) uses the dev bypass and opens without sign-in.
    // The plain browser preview has no Accounts cookie. Give it the local stub
    // session (instead of the dev bypass) so the switcher is visible locally;
    // a request that already carries cookies is left exactly as the tests send
    // it, which keeps the signed-out branches testable.
    const worksWithCookies = Boolean(req.headers.cookie);
    if (!worksWithCookies) headers.set('cookie', 'gothwad_at=good');
    const requestEnv = worksWithCookies ? { ...env, DEV_AUTH_USERNAME: undefined } : env;

    const response = await worker.fetch(request, requestEnv);
    res.statusCode = response.status;
    for (const [key, value] of response.headers) {
      if (key === 'content-encoding' || key === 'transfer-encoding') continue;
      res.setHeader(key, value);
    }
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    console.error('preview_server_error', error);
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: 'preview_server_error' }));
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Mail API (local D1) listening on http://0.0.0.0:${PORT} for "${USERNAME}@${env.APP_DOMAIN}"`);
});
