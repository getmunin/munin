#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdtempSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DRY_RUN = process.argv.includes('--dry-run');

const raw = process.env.PUBLISHED_PACKAGES;
if (!raw) {
  console.error('PUBLISHED_PACKAGES env not set');
  process.exit(2);
}

const published = JSON.parse(raw);
if (published.length === 0) {
  console.log('No packages published; skipping aggregated Release.');
  process.exit(0);
}

const version = published[0].version;
const tag = `v${version}`;

const pkgJsonPaths = execFileSync(
  'find',
  ['apps', 'packages', '-maxdepth', '2', '-name', 'package.json', '-not', '-path', '*/node_modules/*'],
  { cwd: REPO_ROOT, encoding: 'utf8' },
)
  .trim()
  .split('\n');

const nameToDir = new Map();
for (const rel of pkgJsonPaths) {
  const data = JSON.parse(readFileSync(join(REPO_ROOT, rel), 'utf8'));
  if (data.name) nameToDir.set(data.name, dirname(rel));
}

function extractVersionSection(text, ver) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l === `## ${ver}`);
  if (start === -1) return null;
  const end = lines.findIndex((l, i) => i > start && /^## \S/.test(l));
  return lines.slice(start, end === -1 ? lines.length : end).join('\n');
}

function parseEntries(section) {
  const entries = [];
  const blocks = section.split(/^### /m).slice(1);
  for (const block of blocks) {
    const nl = block.indexOf('\n');
    const heading = block.slice(0, nl).trim();
    const body = block.slice(nl + 1);
    const bullets = body.split(/^- /m).slice(1);
    for (const bullet of bullets) {
      if (/^@getmunin\//.test(bullet)) continue;
      if (/^Updated dependencies\b/.test(bullet)) continue;
      entries.push({ heading, body: `- ${bullet.trimEnd()}` });
    }
  }
  return entries;
}

const unique = new Map();
for (const { name, version: v } of published) {
  const dir = nameToDir.get(name);
  if (!dir) continue;
  const clPath = join(REPO_ROOT, dir, 'CHANGELOG.md');
  if (!existsSync(clPath)) continue;
  const section = extractVersionSection(readFileSync(clPath, 'utf8'), v);
  if (!section) continue;
  for (const e of parseEntries(section)) {
    if (!unique.has(e.body)) unique.set(e.body, e);
  }
}

const HEADING_ORDER = ['Major Changes', 'Minor Changes', 'Patch Changes'];
const byHeading = new Map();
for (const e of unique.values()) {
  if (!byHeading.has(e.heading)) byHeading.set(e.heading, []);
  byHeading.get(e.heading).push(e.body);
}
const sortedHeadings = [...byHeading.keys()].sort(
  (a, b) => HEADING_ORDER.indexOf(a) - HEADING_ORDER.indexOf(b),
);

const lines = [];
for (const h of sortedHeadings) {
  lines.push(`### ${h}`, '', byHeading.get(h).join('\n\n'), '');
}

const packageList = published.map((p) => `- \`${p.name}@${p.version}\``).join('\n');

const body = [
  ...(lines.length ? lines : ['No changeset-level changes; internal dependency bumps only.', '']),
  '## Published packages',
  '',
  packageList,
  '',
].join('\n');

const summary = `${tag} · ${published.length} package(s) · ${unique.size} unique entr${unique.size === 1 ? 'y' : 'ies'}`;

if (DRY_RUN) {
  console.log(`[dry-run] Would create Release ${summary}`);
  console.log('--- notes ---');
  console.log(body);
  console.log('--- end notes ---');
  process.exit(0);
}

const tmp = mkdtempSync(join(tmpdir(), 'release-'));
const notesPath = join(tmp, 'notes.md');
writeFileSync(notesPath, body);

console.log(`Creating Release ${summary}`);
execFileSync('gh', ['release', 'create', tag, '--title', tag, '--notes-file', notesPath], {
  stdio: 'inherit',
  cwd: REPO_ROOT,
});
