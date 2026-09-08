import { describe, expect, it } from 'vitest';
import { partitionReviewQueue, resolveReviewFirstRun } from './review-queue';
import type { QueueItem } from './queue-panes/types';

function item(kind: QueueItem['kind'], id: string, createdAt: string): QueueItem {
  return { kind, id, title: id, snippet: '', createdAt, raw: {} } as QueueItem;
}

describe('partitionReviewQueue', () => {
  it('routes knowledge proposals to improvements and every other kind to blocking', () => {
    const { blocking, improvements } = partitionReviewQueue([
      item('kb', 'kb', '2026-09-02T10:00:00.000Z'),
      item('cms', 'cms', '2026-09-02T10:00:00.000Z'),
      item('crm', 'crm', '2026-09-02T10:00:00.000Z'),
      item('outreach', 'outreach', '2026-09-02T10:00:00.000Z'),
    ]);
    expect(improvements.map((i) => i.id)).toEqual(['kb']);
    expect(blocking.map((i) => i.id).sort()).toEqual(['cms', 'crm', 'outreach']);
  });

  it('puts feedback awaiting approval in blocking — someone is waiting on that decision', () => {
    const { blocking } = partitionReviewQueue([
      item('feedback', 'fbk', '2026-09-02T10:00:00.000Z'),
    ]);
    expect(blocking.map((i) => i.id)).toEqual(['fbk']);
  });

  it('sorts blocking oldest first so the longest wait surfaces at the top', () => {
    const { blocking } = partitionReviewQueue([
      item('cms', 'new', '2026-09-02T10:00:00.000Z'),
      item('outreach', 'old', '2026-08-28T10:00:00.000Z'),
      item('crm', 'mid', '2026-09-01T10:00:00.000Z'),
    ]);
    expect(blocking.map((i) => i.id)).toEqual(['old', 'mid', 'new']);
  });

  it('sorts improvements newest first — they carry no deadline', () => {
    const { improvements } = partitionReviewQueue([
      item('kb', 'old', '2026-08-28T10:00:00.000Z'),
      item('kb', 'new', '2026-09-02T10:00:00.000Z'),
    ]);
    expect(improvements.map((i) => i.id)).toEqual(['new', 'old']);
  });

  it('keeps an unparseable timestamp in the list instead of dropping the item', () => {
    const { blocking } = partitionReviewQueue([
      item('cms', 'dated', '2026-09-02T10:00:00.000Z'),
      item('cms', 'broken', 'not-a-date'),
    ]);
    expect(blocking.map((i) => i.id)).toEqual(['broken', 'dated']);
  });

  it('leaves the source array untouched', () => {
    const queue = [
      item('cms', 'a', '2026-09-02T10:00:00.000Z'),
      item('cms', 'b', '2026-08-28T10:00:00.000Z'),
    ];
    partitionReviewQueue(queue);
    expect(queue.map((i) => i.id)).toEqual(['a', 'b']);
  });
});

describe('resolveReviewFirstRun', () => {
  const now = new Date('2026-09-08T10:00:00.000Z').getTime();
  const unloaded = { loaded: false, empty: false };

  it('answers from the setup snapshot before the lists land, so no skeleton precedes first run', () => {
    const setupQueue = { hasPendingItems: false, lastDecisionAt: null };
    expect(resolveReviewFirstRun(setupQueue, unloaded, now)).toBe(true);
  });

  it('waits for the lists when the snapshot predates them', () => {
    expect(resolveReviewFirstRun(null, unloaded, now)).toBeNull();
  });

  it('waits for the lists when the snapshot reports work waiting', () => {
    const setupQueue = { hasPendingItems: true, lastDecisionAt: null };
    expect(resolveReviewFirstRun(setupQueue, unloaded, now)).toBeNull();
  });

  it('waits for the lists when a decision still falls inside the decided window', () => {
    const setupQueue = { hasPendingItems: false, lastDecisionAt: '2026-09-01T10:00:00.000Z' };
    expect(resolveReviewFirstRun(setupQueue, unloaded, now)).toBeNull();
  });

  it('ignores a decision that has aged out of the decided window', () => {
    const setupQueue = { hasPendingItems: false, lastDecisionAt: '2026-01-01T10:00:00.000Z' };
    expect(resolveReviewFirstRun(setupQueue, unloaded, now)).toBe(true);
  });

  it('lets the loaded lists overrule a snapshot that has gone stale', () => {
    const setupQueue = { hasPendingItems: false, lastDecisionAt: null };
    expect(resolveReviewFirstRun(setupQueue, { loaded: true, empty: false }, now)).toBe(false);
    expect(resolveReviewFirstRun(setupQueue, { loaded: true, empty: true }, now)).toBe(true);
  });
});
