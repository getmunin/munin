import { describe, expect, it } from 'vitest';
import {
  DEFAULT_QUEUE_FILTERS,
  activeQueueFilterCount,
  buildQueueFilterQuery,
  queueFiltersActive,
  type QueueFilters,
} from './conversation-queue';

const at = (overrides: Partial<QueueFilters>): QueueFilters => ({
  ...DEFAULT_QUEUE_FILTERS,
  ...overrides,
});

describe('queueFiltersActive', () => {
  it('is false for the default, so the page keeps its three-section queue', () => {
    expect(queueFiltersActive(DEFAULT_QUEUE_FILTERS)).toBe(false);
    expect(buildQueueFilterQuery(DEFAULT_QUEUE_FILTERS)).toBe('');
  });

  it('counts each narrowed dimension', () => {
    expect(activeQueueFilterCount(at({ status: 'spam' }))).toBe(1);
    expect(activeQueueFilterCount(at({ status: 'spam', channelType: 'email' }))).toBe(2);
    expect(
      activeQueueFilterCount(at({ status: 'closed', origin: 'auto', since: '7d', topicId: 'ctp_1' })),
    ).toBe(4);
  });
});

describe('buildQueueFilterQuery', () => {
  it('maps the origin shorthands onto the suppressedReason parameter', () => {
    expect(buildQueueFilterQuery(at({ origin: 'human' }))).toBe('suppressedReason=none');
    expect(buildQueueFilterQuery(at({ origin: 'auto' }))).toBe('suppressedReason=any');
    expect(buildQueueFilterQuery(at({ origin: 'auto_reply' }))).toBe('suppressedReason=auto_reply');
    expect(buildQueueFilterQuery(at({ origin: 'spam_sender' }))).toBe(
      'suppressedReason=spam_sender',
    );
  });

  it('turns a relative window into the absolute timestamp the API expects', () => {
    const now = Date.parse('2026-09-14T12:00:00.000Z');
    expect(buildQueueFilterQuery(at({ since: '1d' }), now)).toBe(
      'since=2026-09-13T12%3A00%3A00.000Z',
    );
    expect(buildQueueFilterQuery(at({ since: '30d' }), now)).toBe(
      'since=2026-08-15T12%3A00%3A00.000Z',
    );
  });

  it('appends the trimmed search term so the server, not the loaded page, does the matching', () => {
    expect(buildQueueFilterQuery(DEFAULT_QUEUE_FILTERS, Date.now(), '  payslip  ')).toBe(
      'q=payslip',
    );
    expect(buildQueueFilterQuery(DEFAULT_QUEUE_FILTERS, Date.now(), '   ')).toBe('');
    expect(buildQueueFilterQuery(at({ status: 'closed' }), Date.now(), 'anders@example.com')).toBe(
      'status=closed&q=anders%40example.com',
    );
  });

  it('combines every dimension into one query', () => {
    const now = Date.parse('2026-09-14T12:00:00.000Z');
    expect(
      buildQueueFilterQuery(
        at({ status: 'spam', origin: 'spam_sender', channelType: 'email', topicId: 'ctp_1', since: '7d' }),
        now,
      ),
    ).toBe(
      'status=spam&suppressedReason=spam_sender&channelType=email&topicId=ctp_1&since=2026-09-07T12%3A00%3A00.000Z',
    );
  });
});
