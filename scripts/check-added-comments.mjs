#!/usr/bin/env node
import { execFileSync } from 'node:child_process';

const CHECKED_FILE = /\.(ts|tsx|mts|cts)$/;

const EXEMPT_FILES = new Set(['packages/db/src/schema.ts']);

const ALLOWED = [
  /^\/\/\/\s*<reference\b/,
  /^\/\/\s*eslint-(disable|enable)/,
  /^\/\/\s*@ts-(expect-error|ignore|nocheck|check)\b/,
  /^\/\*\s*(eslint|@ts-|istanbul\s+ignore|v8\s+ignore|@__PURE__|@vite-ignore)/,
];

function isAllowed(comment) {
  return ALLOWED.some((re) => re.test(comment));
}

function trailingCommentIndex(line) {
  let from = 0;
  for (;;) {
    const i = line.indexOf('//', from);
    if (i <= 0) return -1;
    if (line[i - 1] === ' ' || line[i - 1] === '\t') return i;
    from = i + 2;
  }
}

function commentIn(line) {
  const trimmed = line.trim();
  if (trimmed.startsWith('//') || trimmed.startsWith('/*')) return trimmed;
  const i = trailingCommentIndex(line);
  return i === -1 ? null : line.slice(i).trim();
}

const diff = execFileSync(
  'git',
  ['diff', '--cached', '-U0', '--diff-filter=ACMR', '--no-color'],
  { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
);

let file = null;
let checking = false;
let lineNo = 0;
const findings = [];

for (const raw of diff.split('\n')) {
  if (raw.startsWith('+++ b/')) {
    file = raw.slice(6);
    checking = CHECKED_FILE.test(file) && !EXEMPT_FILES.has(file);
    continue;
  }
  if (raw.startsWith('@@')) {
    const m = /\+(\d+)/.exec(raw);
    lineNo = m ? Number(m[1]) : 0;
    continue;
  }
  if (!checking || !raw.startsWith('+') || raw.startsWith('+++')) continue;
  const line = raw.slice(1);
  const current = lineNo;
  lineNo += 1;
  const comment = commentIn(line);
  if (comment && !isAllowed(comment)) {
    findings.push(`${file}:${current}  ${line.trim()}`);
  }
}

if (findings.length > 0) {
  console.error('✖ New comments in staged TS/TSX changes:\n');
  for (const f of findings) console.error(`  ${f}`);
  console.error(
    '\nThis repo keeps TS/TSX comment-free — put rationale in the commit message,',
  );
  console.error(
    'PR body, changeset, or a test name instead. Directives (eslint-disable,',
  );
  console.error(
    '@ts-expect-error, /// <reference>) are allowed. Bypass deliberately with',
  );
  console.error('git commit --no-verify.');
  process.exit(1);
}
