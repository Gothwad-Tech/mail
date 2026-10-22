// =============================================================================
// Repository language hygiene.
//
// Gothwad Mail is a public repository with a single owner-facing UI, so every
// shipped string, code comment and document is written in English. Chat with the
// owner can be Hinglish; the repository cannot, because a mixed-language codebase
// is what makes the next contributor guess.
//
// Scope: `src/`, `worker/src/`, `docs/` and the root Markdown files.
// Deliberately excluded, because they are data rather than prose:
//   - `tests/`, `worker/test/`: fixtures that prove non-Latin mail bodies work
//   - `tools/`: local demo mail and the local Accounts stand-in
// =============================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SCAN_DIRS = ['src', 'worker/src', 'docs'];
const SCAN_FILES = ['AGENTS.md', 'README.md', 'TASK.md', 'PLAN.md'];
const SCANNED_EXT = /\.(ts|tsx|js|mjs|css|html|md)$/;

/** Words that are Hindi/Hinglish and have no English meaning. Anything
 * ambiguous on its own ("me", "to", "par") is left out on purpose. */
const HINGLISH = [
  'abhi', 'andar', 'badle', 'banao', 'banaya', 'bilkul', 'bheja', 'chahiye', 'dikhe',
  'hai', 'hain', 'hoga', 'hogi', 'jaisa', 'kaise', 'karo', 'karein', 'karna', 'karne',
  'koi', 'kyunki', 'kyun', 'likho', 'liye', 'matlab', 'nahi', 'nahin', 'rahe', 'sirf',
  'sach', 'tak', 'wala', 'wahi', 'yaad', 'yeh',
];

const HINGLISH_RE = new RegExp(`\\b(${HINGLISH.join('|')})\\b`, 'i');
const DEVANAGARI_RE = /[\u0900-\u097F]/;

function walk(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry.startsWith('.')) continue;
      out.push(...walk(full));
    } else if (SCANNED_EXT.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const files = [
  ...SCAN_DIRS.flatMap((dir) => walk(join(ROOT, dir))),
  ...SCAN_FILES.map((name) => join(ROOT, name)).filter((file) => {
    try {
      return statSync(file).isFile();
    } catch {
      return false;
    }
  }),
];

test('the scan actually covers the source tree', () => {
  assert.ok(files.length > 40, `expected a real tree, scanned ${files.length} files`);
  assert.ok(files.some((file) => file.endsWith('src/App.tsx')));
  assert.ok(files.some((file) => file.endsWith('worker/src/index.ts')));
});

test('no file outside tests/tools contains Hindi/Hinglish', () => {
  const problems: string[] = [];
  for (const file of files) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, index) => {
      if (DEVANAGARI_RE.test(line)) {
        problems.push(`${relative(ROOT, file)}:${index + 1} contains Devanagari text`);
      }
      const hit = HINGLISH_RE.exec(line);
      if (hit) {
        problems.push(`${relative(ROOT, file)}:${index + 1} contains "${hit[1]}"`);
      }
    });
  }
  assert.deepEqual(problems, [], 'rewrite these lines in English');
});

test('user-facing copy has no leftover placeholder text', () => {
  const app = readFileSync(join(ROOT, 'src/App.tsx'), 'utf8');
  assert.equal(/lorem ipsum|TODO|FIXME/i.test(app), false);
  const manifest = JSON.parse(readFileSync(join(ROOT, 'public/manifest.json'), 'utf8')) as {
    name: string;
    description: string;
  };
  assert.equal(HINGLISH_RE.test(`${manifest.name} ${manifest.description}`), false);
});
