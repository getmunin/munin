#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const ALLOWED_MISSING_TOOLS = {
  crm_close_deal:
    'crm/progress-deal-through-pipeline names it to say it does not exist — closure is implicit in a terminal-stage transition',
};

const NOT_TOOL_NAMES = {
  cms_entry_impression:
    'a subjectType string the caller passes to window.mn.analytics.track, not a tool',
  cms_curation_proposals:
    'a proposed future table in the review-stale-entries Future work section, not a tool',
};

const SKILL_PATH = /^packages\/backend-core\/src\/modules\/[a-z-]+\/skills\/[a-z0-9-]+\.md$/;
const TOOL_SOURCE = /\.tools\.ts$/;
const IDENTIFIER_SOURCE = /\.(ts|tsx|sql)$/;
const TEST_SOURCE = /\.(test|integration\.test|spec)\.(ts|tsx)$/;

const TOOL_NAME_IN_SOURCE = /name:\s*'([a-z][a-z0-9_]*)'/g;
const TOOL_CALL_IN_SKILL = /"name"\s*:\s*"([a-z][a-z0-9_]*)"/g;
const SNAKE_TOKEN = /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g;

function trackedFiles() {
  return execFileSync('git', ['ls-files', '-z'], { maxBuffer: 1 << 28 })
    .toString()
    .split('\0')
    .filter(Boolean);
}

function read(file) {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

const files = trackedFiles();

const tools = new Set();
for (const file of files.filter((f) => TOOL_SOURCE.test(f))) {
  const text = read(file);
  if (!text) continue;
  for (const m of text.matchAll(TOOL_NAME_IN_SOURCE)) tools.add(m[1]);
}

if (tools.size === 0) {
  console.error(
    'check-skill-tool-refs: found no MCP tools to check against — refusing to pass vacuously.',
  );
  process.exit(1);
}

const prefixes = new Set([...tools].map((t) => t.split('_')[0]));

const knownIdentifiers = new Set();
for (const file of files) {
  if (!IDENTIFIER_SOURCE.test(file) || TEST_SOURCE.test(file)) continue;
  const text = read(file);
  if (!text) continue;
  for (const m of text.matchAll(SNAKE_TOKEN)) knownIdentifiers.add(m[0]);
}

const excused = (token) => token in ALLOWED_MISSING_TOOLS || token in NOT_TOOL_NAMES;

const problems = [];

for (const file of files.filter((f) => SKILL_PATH.test(f))) {
  const text = read(file);
  if (!text) continue;
  text.split('\n').forEach((line, i) => {
    for (const m of line.matchAll(TOOL_CALL_IN_SKILL)) {
      const token = m[1];
      if (!prefixes.has(token.split('_')[0]) || !token.includes('_')) continue;
      if (tools.has(token) || excused(token)) continue;
      problems.push({ file, line: i + 1, token, kind: 'call' });
    }
    for (const m of line.matchAll(SNAKE_TOKEN)) {
      const token = m[0];
      if (!prefixes.has(token.split('_')[0])) continue;
      if (tools.has(token) || knownIdentifiers.has(token) || excused(token)) continue;
      if (problems.some((p) => p.file === file && p.line === i + 1 && p.token === token)) continue;
      problems.push({ file, line: i + 1, token, kind: 'prose' });
    }
  });
}

if (problems.length === 0) process.exit(0);

const calls = problems.filter((p) => p.kind === 'call');
const prose = problems.filter((p) => p.kind === 'prose');

console.error('\nSkills naming tools that do not exist:\n');

if (calls.length) {
  console.error('  Used in a tool-call position ("name": "…") but matching no @McpTool:');
  for (const p of calls) console.error(`    ${p.file}:${p.line}  ${p.token}`);
  console.error('');
}

if (prose.length) {
  console.error('  Named in prose, matching no @McpTool and no identifier in non-test source:');
  for (const p of prose) console.error(`    ${p.file}:${p.line}  ${p.token}`);
  console.error('');
}

console.error(
  '  A skill is the agent-facing UI for a feature, so a tool name in one is a\n' +
    '  promise an agent will try to keep. These names are stale, renamed, or invented.\n\n' +
    '  Fix the skill to name the tool that exists. If a skill deliberately says a tool\n' +
    '  does NOT exist, add it to ALLOWED_MISSING_TOOLS in\n' +
    '  scripts/check-skill-tool-refs.mjs; if the name is something other than a tool\n' +
    '  (an event type, a table, a config key), add it to NOT_TOOL_NAMES. Both take a\n' +
    '  reason, and both are a review checkpoint — adding an entry is a decision.\n',
);
process.exit(1);
