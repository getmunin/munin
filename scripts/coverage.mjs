#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

if (existsSync(resolve(ROOT, '.env'))) process.loadEnvFile(resolve(ROOT, '.env'));

/**
 * One coverage run across the whole monorepo, aggregated into a single number.
 *
 * The repo has no shared vitest root config (each package owns its own, and
 * the Nest packages need an swc plugin), so coverage is driven per-package
 * here instead. `mode: 'borrow'` packages ship no vitest of their own — we
 * lend them backend-core's binary via `--root` so their untested source still
 * counts against the denominator (`coverage.all`) rather than vanishing.
 */
const PACKAGES = [
  { dir: 'packages/agent-host', filter: '@getmunin/agent-host', include: ['src/**/*.ts'] },
  { dir: 'packages/agent-runtime', filter: '@getmunin/agent-runtime', include: ['src/**/*.ts'] },
  { dir: 'packages/backend-core', filter: '@getmunin/backend-core', include: ['src/**/*.ts'] },
  { dir: 'packages/core', filter: '@getmunin/core', include: ['src/**/*.ts'] },
  { dir: 'packages/db', filter: '@getmunin/db', include: ['src/**/*.ts'] },
  { dir: 'packages/emails', filter: '@getmunin/emails', include: ['src/**/*.{ts,tsx}'] },
  { dir: 'packages/mcp-toolkit', filter: '@getmunin/mcp-toolkit', include: ['src/**/*.ts'] },
  { dir: 'packages/sdk', filter: '@getmunin/sdk', include: ['src/**/*.ts'] },
  { dir: 'packages/types', filter: '@getmunin/types', include: ['src/**/*.ts'] },
  { dir: 'packages/widget-voice', filter: '@getmunin/widget-voice', include: ['src/**/*.ts'] },
  {
    dir: 'apps/analytics-tracker',
    filter: '@getmunin/analytics-tracker',
    include: ['src/**/*.ts'],
  },
  { dir: 'apps/backend', filter: '@getmunin/backend', include: ['src/**/*.ts'] },
  { dir: 'apps/chat-widget', filter: '@getmunin/chat-widget', include: ['src/**/*.{ts,tsx}'] },
  {
    dir: 'apps/web',
    filter: '@getmunin/web',
    include: ['app/**/*.{ts,tsx}', 'i18n/**/*.{ts,tsx}'],
  },
  { dir: 'packages/dashboard-pages', mode: 'borrow', include: ['src/**/*.{ts,tsx}'] },
  { dir: 'packages/docs-pages', mode: 'borrow', include: ['src/**/*.{ts,tsx}'] },
  { dir: 'packages/ui', mode: 'borrow', include: ['src/**/*.{ts,tsx}'] },
];

const BORROW_FILTER = '@getmunin/backend-core';
const METRICS = ['lines', 'statements', 'functions', 'branches'];

const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const targets = only.length
  ? PACKAGES.filter((p) => only.some((o) => p.dir.includes(o) || (p.filter ?? '').includes(o)))
  : PACKAGES;

function runOne(pkg) {
  const reportsDir = resolve(ROOT, pkg.dir, 'coverage');
  const baseArgs = [
    'run',
    '--passWithNoTests',
    '--coverage',
    '--coverage.provider=v8',
    '--coverage.all',
    '--coverage.reporter=json-summary',
    '--coverage.reporter=html',
    `--coverage.reportsDirectory=${reportsDir}`,
    '--exclude=**/dist/**',
    ...pkg.include.map((g) => `--coverage.include=${g}`),
  ];
  const args =
    pkg.mode === 'borrow'
      ? ['-F', BORROW_FILTER, 'exec', 'vitest', ...baseArgs, '--root', resolve(ROOT, pkg.dir)]
      : ['-F', pkg.filter, 'exec', 'vitest', ...baseArgs];

  process.stdout.write(`  • ${pkg.dir} … `);
  const res = spawnSync('pnpm', args, { cwd: ROOT, encoding: 'utf8', env: process.env });
  const summaryPath = resolve(reportsDir, 'coverage-summary.json');
  const ok = res.status === 0;
  if (!existsSync(summaryPath)) {
    console.log(ok ? 'no report' : 'FAILED (no report)');
    return { ...pkg, total: null, failed: !ok };
  }
  const total = JSON.parse(readFileSync(summaryPath, 'utf8')).total;
  console.log(`${pct(total.lines)}${ok ? '' : '  ⚠ tests failed'}`);
  return { ...pkg, total, failed: !ok };
}

function pct(m) {
  return m.total === 0 ? '—' : `${((m.covered / m.total) * 100).toFixed(1)}%`;
}

console.log(`\nCoverage across ${targets.length} package(s)\n`);
const results = targets.map(runOne);

const agg = Object.fromEntries(METRICS.map((k) => [k, { covered: 0, total: 0 }]));
const tested = Object.fromEntries(METRICS.map((k) => [k, { covered: 0, total: 0 }]));
for (const r of results) {
  if (!r.total) continue;
  for (const k of METRICS) {
    agg[k].covered += r.total[k].covered;
    agg[k].total += r.total[k].total;
    if (r.total.lines.covered > 0) {
      tested[k].covered += r.total[k].covered;
      tested[k].total += r.total[k].total;
    }
  }
}

const withData = results.filter((r) => r.total);
withData.sort((a, b) => b.total.lines.pct - a.total.lines.pct);
console.log('\n  package                         lines            line%    func%');
console.log('  ' + '─'.repeat(62));
for (const r of withData) {
  const l = r.total.lines;
  console.log(
    `  ${r.dir.padEnd(31)} ${`${l.covered}/${l.total}`.padEnd(13)} ${pct(l).padStart(7)}  ${pct(
      r.total.functions,
    ).padStart(7)}`,
  );
}
console.log('  ' + '─'.repeat(62));
console.log(`  WHOLE REPO   lines ${agg.lines.covered}/${agg.lines.total} = ${pct(agg.lines)}`);
console.log(
  `  TESTED PKGS  lines ${tested.lines.covered}/${tested.lines.total} = ${pct(tested.lines)}`,
);

const failed = results.filter((r) => r.failed).map((r) => r.dir);
if (failed.length)
  console.log(`\n  ⚠ tests failed (coverage still measured): ${failed.join(', ')}`);

mkdirSync(resolve(ROOT, 'coverage'), { recursive: true });
writeFileSync(
  resolve(ROOT, 'coverage', 'summary.json'),
  JSON.stringify(
    {
      wholeRepo: agg,
      testedPackages: tested,
      packages: results.map((r) => ({ dir: r.dir, total: r.total, failed: r.failed })),
    },
    null,
    2,
  ),
);
console.log('\n  aggregate written to coverage/summary.json\n');
