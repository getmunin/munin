import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';

interface JournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

const here = dirname(fileURLToPath(import.meta.url));
const drizzleDir = resolve(here, '..', 'drizzle');
const journalPath = resolve(drizzleDir, 'meta', '_journal.json');

const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: JournalEntry[] };
const entries = [...journal.entries].sort((a, b) => a.idx - b.idx);

describe('drizzle migration journal', () => {
  it('has entries', () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  it('idx values are contiguous from 0', () => {
    entries.forEach((e, i) => {
      expect(e.idx, `journal entry "${e.tag}" has idx ${e.idx}, expected ${i}`).toBe(i);
    });
  });

  // The bug this guards against: drizzle's migrator applies a migration only when
  // its `when` is greater than the newest timestamp already recorded in the target
  // database. A migration whose `when` is *lower* than an earlier one is therefore
  // silently skipped on any DB that is already past that earlier timestamp — while
  // a fresh DB (CI) applies everything in idx order and looks fine. So an out-of-order
  // timestamp only breaks real, already-migrated deployments. Keep `when` strictly
  // increasing with idx and CI catches it before release.
  it('`when` timestamps are strictly increasing with idx', () => {
    for (let i = 1; i < entries.length; i++) {
      const prev = entries[i - 1]!;
      const cur = entries[i]!;
      expect(
        cur.when,
        `Migration "${cur.tag}" (idx ${cur.idx}, when=${cur.when}) must have a later \`when\` than ` +
          `"${prev.tag}" (idx ${prev.idx}, when=${prev.when}). Out-of-order timestamps are silently ` +
          `skipped by drizzle on databases already past the earlier timestamp.`,
      ).toBeGreaterThan(prev.when);
    }
  });

  it('every journal entry maps 1:1 to a migration .sql file', () => {
    const sqlFiles = readdirSync(drizzleDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    const tagged = entries.map((e) => `${e.tag}.sql`).sort();
    expect(sqlFiles).toEqual(tagged);
  });
});
