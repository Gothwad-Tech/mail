// HTML asset integrity + hosting files.
//
// Opening `/u/1/` directly (F5 on a deep link) must load every asset. That only
// works when every URL in the HTML is root-relative (`/assets/...`) and the host
// rewrites unknown paths to index.html. This test enforces both, plus the cache
// headers that stop a deploy from serving stale HTML/JS.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

/** Local src=/href= values from index.html. */
function localUrls(html: string): string[] {
  const urls: string[] = [];
  for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const url = match[1];
    if (url.startsWith('http') || url.startsWith('data:') || url.startsWith('#')) continue;
    urls.push(url.split('#')[0].split('?')[0]);
  }
  return [...new Set(urls)];
}

test('every local asset in index.html is root-relative and exists', () => {
  const urls = localUrls(read('index.html'));
  assert.ok(urls.length >= 4, 'index.html references its icons and manifest');

  for (const url of urls) {
    assert.equal(url.startsWith('/'), true, `${url} must be root-relative for /u/1/ to work`);
    // /src/main.tsx is the Vite dev entry; it does not exist in public/.
    if (url.startsWith('/src/')) continue;
    const file = join(ROOT, 'public', url);
    assert.equal(existsSync(file), true, `${url} is missing from public/`);
  }
});

test('the manifest references only existing icons', () => {
  const manifest = JSON.parse(read('public/manifest.json')) as {
    icons: Array<{ src: string }>;
    start_url: string;
    scope: string;
  };
  for (const icon of manifest.icons) {
    assert.equal(icon.src.startsWith('/'), true, `${icon.src} must be root-relative`);
    assert.equal(existsSync(join(ROOT, 'public', icon.src)), true, `${icon.src} is missing`);
  }
  assert.equal(manifest.scope, '/');
  // start_url stays "/" so the boot normaliser picks the tab's account.
  assert.equal(manifest.start_url, '/');
});

test('exactly one web manifest is emitted, and index.html links it', () => {
  const vite = read('vite.config.ts');
  // The plugin would otherwise emit /manifest.webmanifest next to the hand
  // written /manifest.json that index.html links: two install prompts.
  assert.match(vite, /manifest:\s*false/, 'the plugin must not generate a second manifest');
  assert.match(read('index.html'), /rel="manifest" href="\/manifest.json"/);
  const srcs = JSON.parse(read('public/manifest.json')) as { icons: Array<{ src: string }> };
  for (const icon of srcs.icons) {
    assert.equal(existsSync(join(ROOT, 'public', icon.src)), true, `${icon.src} is not shipped`);
  }
});

test('the service worker never caches /api', () => {
  const vite = read('vite.config.ts');
  assert.match(vite, /navigateFallbackDenylist:\s*\[\/\^\\\/api\\\/\//, 'API paths bypass the SPA fallback');
  // Any runtimeCaching rule that matched /api would keep mail bodies on disk.
  const runtime = vite.slice(vite.indexOf('runtimeCaching:'));
  const rules = runtime.slice(0, runtime.indexOf('devOptions'));
  assert.equal(/\/api\//.test(rules), false, 'no /api rule in runtimeCaching');
  assert.match(vite, /globPatterns: \['\*\*\/\*\.\{js,css,html,ico,png,svg,woff,woff2\}'\]/);
});

test('Cloudflare Pages rewrites deep paths to the SPA shell', () => {
  const redirects = read('public/_redirects');
  assert.match(redirects, /^\/u\/\* {2,}\/index\.html {2,}200$/m);
  assert.match(redirects, /^\/mail\/u\/\* {2,}\/index\.html {2,}200$/m);
  assert.match(redirects, /^\/\* {2,}\/index\.html {2,}200$/m);
});

test('HTML and JS are never cached stale after a deploy', () => {
  const headers = read('public/_headers');
  assert.match(headers, /max-age=0, must-revalidate/);
  assert.match(headers, /X-Content-Type-Options: nosniff/);
});

test('the dev server serves index.html for deep paths (no 404 on /u/1/)', () => {
  // Vite's SPA fallback does this in development; the Pages rewrite does it in
  // production. This assertion documents the contract both must keep.
  const vite = read('vite.config.ts');
  assert.match(vite, /appType:\s*'spa'/, 'vite must keep the SPA fallback explicit');
});
