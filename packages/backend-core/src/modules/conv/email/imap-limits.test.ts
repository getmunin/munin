import { describe, expect, it } from 'vitest';
import { IMAP_PARSER_LIMITS, planImapDownloads } from './imap-limits.ts';

const MB = 1024 * 1024;
const opts = { sinceUid: 10, limit: 100, maxMessageBytes: 40 * MB, maxBatchBytes: 64 * MB };

describe('planImapDownloads', () => {
  it('fetches ordinary messages in uid order and ignores uids at or below the cursor', () => {
    const plan = planImapDownloads(
      [
        { uid: 13, size: 2_000 },
        { uid: 9, size: 1_000 },
        { uid: 11, size: 1_000 },
        { uid: 10, size: 1_000 },
      ],
      opts,
    );
    expect(plan.fetch.map((e) => e.uid)).toEqual([11, 13]);
    expect(plan.oversized).toEqual([]);
  });

  it('marks a message over the per-message cap as oversized instead of downloading it', () => {
    const plan = planImapDownloads(
      [
        { uid: 11, size: 1_000 },
        { uid: 12, size: 41 * MB },
        { uid: 13, size: 1_000 },
      ],
      opts,
    );
    expect(plan.fetch.map((e) => e.uid)).toEqual([11, 13]);
    expect(plan.oversized).toEqual([{ uid: 12, size: 41 * MB }]);
  });

  it('accepts a message exactly at the per-message cap', () => {
    const plan = planImapDownloads([{ uid: 11, size: 40 * MB }], opts);
    expect(plan.fetch.map((e) => e.uid)).toEqual([11]);
  });

  it('stops the batch before the running total passes the per-tick budget and leaves the rest for later', () => {
    const plan = planImapDownloads(
      [
        { uid: 11, size: 30 * MB },
        { uid: 12, size: 30 * MB },
        { uid: 13, size: 30 * MB },
        { uid: 14, size: 50 * MB },
      ],
      opts,
    );
    expect(plan.fetch.map((e) => e.uid)).toEqual([11, 12]);
    expect(plan.oversized).toEqual([]);
  });

  it('does not mark anything past the budget stop as oversized, so the cursor cannot skip unread mail', () => {
    const plan = planImapDownloads(
      [
        { uid: 11, size: 35 * MB },
        { uid: 12, size: 35 * MB },
        { uid: 13, size: 41 * MB },
      ],
      opts,
    );
    expect(plan.fetch.map((e) => e.uid)).toEqual([11]);
    expect(plan.oversized).toEqual([]);
  });

  it('always lets one message through even when it alone fills the budget', () => {
    const plan = planImapDownloads([{ uid: 11, size: 40 * MB }], {
      ...opts,
      maxBatchBytes: 10 * MB,
    });
    expect(plan.fetch.map((e) => e.uid)).toEqual([11]);
  });

  it('budgets a message whose size the server did not report as if it were at the cap', () => {
    const plan = planImapDownloads(
      [
        { uid: 11, size: null },
        { uid: 12, size: 30 * MB },
      ],
      opts,
    );
    expect(plan.fetch.map((e) => e.uid)).toEqual([11]);
  });

  it('counts oversized messages toward the per-tick limit', () => {
    const plan = planImapDownloads(
      [
        { uid: 11, size: 41 * MB },
        { uid: 12, size: 1_000 },
        { uid: 13, size: 1_000 },
      ],
      { ...opts, limit: 2 },
    );
    expect(plan.oversized.map((e) => e.uid)).toEqual([11]);
    expect(plan.fetch.map((e) => e.uid)).toEqual([12]);
  });

  it('ignores a uid the server reported twice', () => {
    const plan = planImapDownloads(
      [
        { uid: 11, size: 1_000 },
        { uid: 11, size: 1_000 },
      ],
      opts,
    );
    expect(plan.fetch.map((e) => e.uid)).toEqual([11]);
  });
});

describe('IMAP_PARSER_LIMITS', () => {
  it('leaves room in a response for the framing around a literal at the cap', () => {
    expect(IMAP_PARSER_LIMITS.maxResponseSize).toBeGreaterThan(IMAP_PARSER_LIMITS.maxLiteralSize);
  });

  it('replaces the gigabyte-scale library defaults', () => {
    expect(IMAP_PARSER_LIMITS.maxLiteralSize).toBeLessThanOrEqual(64 * MB);
    expect(IMAP_PARSER_LIMITS.maxResponseSize).toBeLessThanOrEqual(64 * MB);
    expect(IMAP_PARSER_LIMITS.maxLineLength).toBeLessThanOrEqual(4 * MB);
  });
});
