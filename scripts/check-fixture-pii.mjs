#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { scanText, renderProblems, ALLOW_LIST_FILES } from './lib/pii.mjs';

const SKIP_PATH =
  /(^|\/)(node_modules|dist|\.next|coverage|\.turbo)\/|^pnpm-lock\.yaml$|^THIRD_PARTY_LICENSES\.md$/;

function trackedFiles() {
  return execFileSync('git', ['ls-files', '-z'], { maxBuffer: 1 << 28 })
    .toString()
    .split('\0')
    .filter((f) => f && !SKIP_PATH.test(f) && !ALLOW_LIST_FILES.has(f));
}

const problems = [];

for (const file of trackedFiles()) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  if (text.includes('\0')) continue;
  problems.push(...scanText(text, { file }));
}

if (problems.length === 0) process.exit(0);

console.error(renderProblems(problems, { surface: 'Fixture data' }));
process.exit(1);
