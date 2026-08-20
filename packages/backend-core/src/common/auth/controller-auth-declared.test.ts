import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC_ROOT = fileURLToPath(new URL('../..', import.meta.url));

function controllerFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...controllerFiles(full));
      continue;
    }
    if (entry.endsWith('.controller.ts')) out.push(full);
  }
  return out;
}

const MARKERS = ['@PublicController(', 'AllowAnonymous()', 'UseGuards(AuthGuard'];

describe('controllers declare their auth stance, because cloud registers AuthGuard as a global APP_GUARD', () => {
  it('every controller either applies AuthGuard itself or opts out via PublicController/AllowAnonymous — a controller that does neither is open in OSS and 401 in cloud', () => {
    const undeclared = controllerFiles(SRC_ROOT)
      .filter((file) => {
        const source = readFileSync(file, 'utf8');
        return !MARKERS.some((marker) => source.includes(marker));
      })
      .map((file) => relative(SRC_ROOT, file));
    expect(undeclared).toEqual([]);
  });
});
