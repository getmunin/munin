import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = new URL('.', import.meta.url).pathname;
const DYNAMIC_TS_IMPORT = /\bimport\(\s*['"`](\.{1,2}\/[^'"`]*\.ts)['"`]\s*\)/g;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path] : [];
  });
}

describe('relative imports', () => {
  it('never import a relative .ts path dynamically, because tsc rewrites .ts to .js only in static imports and the built dist would fail to load it', () => {
    const offenders = sourceFiles(SRC).flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(DYNAMIC_TS_IMPORT)].map(
        (match) => `${relative(SRC, file)}: import('${match[1]}')`,
      ),
    );
    expect(offenders).toEqual([]);
  });
});
