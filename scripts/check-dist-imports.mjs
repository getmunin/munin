#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WORKSPACE_DIRS = ['packages', 'apps'];
const BUILT_SOURCE = /\.[cm]?js$/;
const RELATIVE_TS_SPECIFIER =
  /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)(['"`])(\.{1,2}\/[^'"`\n]*\.[cm]?tsx?)\1/g;

function distDirs() {
  return WORKSPACE_DIRS.flatMap((workspace) => {
    const base = join(ROOT, workspace);
    if (!existsSync(base)) return [];
    return readdirSync(base, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(base, entry.name, 'dist'))
      .filter((dist) => existsSync(dist));
  });
}

function builtFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules') return [];
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return builtFiles(path);
    return BUILT_SOURCE.test(entry.name) ? [path] : [];
  });
}

function lineOf(source, index) {
  return source.slice(0, index).split('\n').length;
}

const files = distDirs().flatMap(builtFiles);
if (files.length === 0) {
  console.error('check-dist-imports: no built files found under packages/*/dist or apps/*/dist — run `pnpm build` first');
  process.exit(1);
}

const offenders = files.flatMap((file) => {
  const source = readFileSync(file, 'utf8');
  return [...source.matchAll(RELATIVE_TS_SPECIFIER)].map(
    (match) => `${relative(ROOT, file)}:${lineOf(source, match.index)}  ${match[2]}`,
  );
});

if (offenders.length > 0) {
  console.error(
    `check-dist-imports: ${offenders.length} built file reference(s) still point at a TypeScript source path, which fails with "Cannot find module" at runtime:\n`,
  );
  for (const offender of offenders) console.error(`  ${offender}`);
  console.error(
    '\ntsc leaves the extension alone for import() inside a class with class-level or constructor-parameter decorators. Use a static import, or move the import() into a module-level function.',
  );
  process.exit(1);
}

console.log(`check-dist-imports: ${files.length} built files, no relative TypeScript import paths`);
