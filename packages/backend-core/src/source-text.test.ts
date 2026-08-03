import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC_ROOT = new URL('.', import.meta.url).pathname;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else if (name.endsWith('.ts') || name.endsWith('.tsx')) {
      out.push(full);
    }
  }
  return out;
}

describe('source files stay greppable text', () => {
  it('contains no NUL byte, which makes grep and ripgrep silently skip the whole file', () => {
    const offenders = walk(SRC_ROOT)
      .filter((file) => readFileSync(file).includes(0))
      .map((file) => relative(SRC_ROOT, file));
    expect(offenders).toEqual([]);
  });
});
