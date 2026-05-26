#!/usr/bin/env node
import { readdirSync, readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const targets = ['packages', 'apps'];

const sourceFiles = [];

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.next' || entry.name === 'build') continue;
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walk(p);
    else if (entry.isFile() && /\.(ts|tsx|mts|cts)$/.test(entry.name)) sourceFiles.push(p);
  }
}

for (const t of targets) walk(join(repoRoot, t));

const importRe = /(from\s+['"]|import\s*\(\s*['"]|require\s*\(\s*['"])(\.{1,2}\/[^'"]+?)\.(js|mjs|cjs|jsx)(['"])/g;

const extMap = { js: ['.ts', '.tsx'], jsx: ['.tsx', '.ts'], mjs: ['.mts'], cjs: ['.cts'] };

let rewrites = 0;
let touched = 0;

for (const file of sourceFiles) {
  const original = readFileSync(file, 'utf8');
  const fileDir = dirname(file);
  const next = original.replace(importRe, (match, prefix, spec, ext, quote) => {
    const candidates = extMap[ext];
    if (!candidates) return match;
    for (const c of candidates) {
      const abs = resolve(fileDir, spec + c);
      if (existsSync(abs)) {
        rewrites++;
        return `${prefix}${spec}${c}${quote}`;
      }
    }
    // also check directory-with-index
    const dirCandidates = ['/index.ts', '/index.tsx', '/index.mts', '/index.cts'];
    for (const c of dirCandidates) {
      const abs = resolve(fileDir, spec + c);
      if (existsSync(abs)) {
        rewrites++;
        return `${prefix}${spec}${c}${quote}`;
      }
    }
    process.stderr.write(`  warn: ${relative(repoRoot, file)} - could not resolve '${spec}.${ext}'\n`);
    return match;
  });
  if (next !== original) {
    writeFileSync(file, next);
    touched++;
  }
}

console.log(`Rewrote ${rewrites} import sites across ${touched} files.`);
