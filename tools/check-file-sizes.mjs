/**
 * =============================================================================
 * FILE SIZE GUARD (`npm run check:sizes`)
 * =============================================================================
 * WHY: one 900-line component is where bugs hide and where a diff stops being
 * reviewable. The rule (AGENTS.md) is:
 *
 *     target <= 500 lines, hard maximum 800 lines, per .ts/.tsx/.mjs source file
 *
 * This script is the enforcement, so the rule does not depend on anyone
 * remembering it:
 *
 *   > 800 lines -> exit 1 (a red test, cannot be merged)
 *   > 500 lines -> warning only (a nudge to split, not a blocker)
 *
 * Docs, JSON, CSS and generated folders are not counted: the limit is about
 * code files a person has to read.
 * =============================================================================
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import process from 'node:process';

const ROOT = new URL('..', import.meta.url).pathname;
// Code AND docs are counted: a 900-line README is just as unreviewable as a
// 900-line component. Generated/lock files are the only exemption.
const SCAN = ['src', 'worker/src', 'worker/test', 'tests', 'tools', 'public', 'docs', 'sql'];
const ROOT_FILES = ['AGENTS.md', 'PLAN.md', 'README.md', 'TASK.md', 'index.html', 'vite.config.ts'];
const CODE = /\.(ts|tsx|mjs|js|css|html|sql|md)$/;
const SKIP_DIRS = new Set(['node_modules', 'dist', 'dev-dist', 'coverage', '.git']);
const TARGET = 500;
const MAX = 500; // hard limit: the owner's rule

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (CODE.test(name)) out.push(full);
  }
  return out;
}

const files = [
  ...SCAN.flatMap((dir) => {
    try {
      return walk(join(ROOT, dir));
    } catch {
      return []; // a folder that does not exist in this checkout
    }
  }),
  ...ROOT_FILES.map((name) => join(ROOT, name)).filter((file) => {
    try {
      return statSync(file).isFile();
    } catch {
      return false;
    }
  }),
];

const rows = files
  .map((file) => {
    const lines = readFileSync(file, 'utf8').replace(/\n$/, '').split('\n').length;
    return { file: relative(ROOT, file), lines };
  })
  .sort((a, b) => b.lines - a.lines);

const over = rows.filter((r) => r.lines > MAX);
const warn = rows.filter((r) => r.lines > TARGET && r.lines <= MAX);

console.log(`file size check: ${rows.length} files (hard max ${MAX} lines)`);
for (const r of over) console.error(`  FAIL  ${String(r.lines).padStart(5)}  ${r.file}  — over the ${MAX}-line hard limit`);

if (over.length > 0) {
  console.error(`\n${over.length} file(s) over ${MAX} lines. Split by responsibility, keep behaviour identical.`);
  process.exit(1);
}
console.log(`ok: no file over ${MAX} lines${warn.length ? ` (${warn.length} between ${TARGET} and ${MAX})` : ''}`);
