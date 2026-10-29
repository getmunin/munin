import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('outreach module boundary', () => {
  it('never imports from the journeys module, which builds on outreach', () => {
    const dir = import.meta.dirname;
    const offenders = readdirSync(dir, { recursive: true, encoding: 'utf8' })
      .filter((file) => file.endsWith('.ts') && !file.includes('.test.'))
      .filter((file) => /from '\.\.\/journeys\//.test(readFileSync(join(dir, file), 'utf8')));
    expect(offenders).toEqual([]);
  });
});
