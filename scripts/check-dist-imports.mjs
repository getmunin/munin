#!/usr/bin/env node
// tsc's rewriteRelativeImportExtensions misses some specifiers (dynamic import() inside
// decorated classes, for one), and dev runs src through a loader that resolves `.ts` anyway,
// so a broken specifier only surfaces in production. Run after `pnpm build`.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOTS = ['packages', 'apps'];
const SPECIFIER =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)(['"])(\.{1,2}\/[^'"]+)\1/g;

function* jsFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') yield* jsFiles(full);
    } else if (/\.(c|m)?js$/.test(entry.name)) {
      yield full;
    }
  }
}

function resolves(fromFile, spec) {
  const target = path.resolve(path.dirname(fromFile), spec);
  if (!existsSync(target)) return false;
  return statSync(target).isFile() || existsSync(path.join(target, 'package.json'));
}

const problems = [];
let scanned = 0;
for (const root of ROOTS) {
  if (!existsSync(root)) continue;
  for (const pkg of readdirSync(root)) {
    const dist = path.join(root, pkg, 'dist');
    if (!existsSync(dist)) continue;
    for (const file of jsFiles(dist)) {
      scanned++;
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        for (const m of line.matchAll(SPECIFIER)) {
          const spec = m[2];
          if (/\.(c|m)?tsx?$/.test(spec)) {
            problems.push(`${file}:${i + 1}: imports TypeScript source '${spec}'`);
          } else if (!resolves(file, spec)) {
            problems.push(`${file}:${i + 1}: '${spec}' does not resolve to a file`);
          }
        }
      });
    }
  }
}

if (scanned === 0) {
  console.error('check-dist-imports: no built dist/ files found — run `pnpm build` first.');
  process.exit(1);
}
if (problems.length > 0) {
  console.error(`check-dist-imports: ${problems.length} broken relative import(s) in built output:\n`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`check-dist-imports: ${scanned} built file(s), all relative imports resolve.`);
