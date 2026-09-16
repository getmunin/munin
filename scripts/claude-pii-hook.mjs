#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { relative, isAbsolute } from 'node:path';
import { scanText, renderProblems } from './lib/pii.mjs';

const PUBLISH =
  /\b(?:git\s+commit|git\s+tag|gh\s+pr\s+(?:create|edit|comment)|gh\s+issue\s+(?:create|comment)|gh\s+release\s+create)\b/;
const WRITE_OP = /(?:^|[^0-9&])>>?\s*(?!&)\S|(?:^|\s)tee\s|(?:^|\s)(?:sed|perl)\s+-i/;
const EPHEMERAL = /\/dev\/null|\/tmp\/|\/private\/tmp\/|\/var\/folders\//;

function allow() {
  process.exit(0);
}

function deny(problems, surface) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: renderProblems(problems, { surface }),
      },
    }),
  );
  process.exit(0);
}

function repoRelative(filePath, cwd) {
  if (!filePath) return null;
  if (!isAbsolute(filePath)) return filePath;
  const rel = relative(cwd, filePath);
  return rel.startsWith('..') ? null : rel;
}

let input;
try {
  input = JSON.parse(readFileSync(0, 'utf8'));
} catch {
  allow();
}

const tool = input.tool_name;
const args = input.tool_input ?? {};
const cwd = input.cwd ?? process.cwd();

if (tool === 'Write' || tool === 'Edit') {
  const file = repoRelative(args.file_path, cwd);
  if (!file) allow();
  const body = tool === 'Write' ? args.content : args.new_string;
  if (typeof body !== 'string' || body.length === 0) allow();
  const problems = scanText(body, { file });
  if (problems.length) deny(problems, `Content headed for ${file}`);
  allow();
}

if (tool === 'Bash') {
  const command = args.command;
  if (typeof command !== 'string') allow();
  const publishes = PUBLISH.test(command);
  const writesToRepo = WRITE_OP.test(command) && !EPHEMERAL.test(command);
  if (!publishes && !writesToRepo) allow();
  const problems = scanText(command, { hostnames: publishes });
  if (problems.length) {
    deny(problems, publishes ? 'Text headed for a published surface' : 'Content headed for a repo file');
  }
}

allow();
