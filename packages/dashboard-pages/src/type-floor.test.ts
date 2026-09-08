import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('.', import.meta.url));

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return entry.isFile() && entry.name.endsWith('.tsx') ? [path] : [];
  });
}

describe('console type floor', () => {
  it('sets no text smaller than 10px', () => {
    const offenders: string[] = [];
    for (const path of sources(SRC)) {
      const lines = readFileSync(path, 'utf8').split('\n');
      lines.forEach((line, index) => {
        for (const [, size] of line.matchAll(/text-\[(\d+(?:\.\d+)?)px\]/g)) {
          if (Number(size) < 10) {
            offenders.push(`${path.slice(SRC.length)}:${index + 1} text-[${size}px]`);
          }
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});
