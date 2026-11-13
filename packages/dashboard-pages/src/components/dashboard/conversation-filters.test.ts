import { describe, expect, it } from 'vitest';
import {
  DEFAULT_QUEUE_FILTERS,
  activeQueueFilterCount,
  buildQueueFilterQuery,
  queueFiltersActive,
  withQueueOrigin,
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
    expect(buildQueueFilterQuery(at({ status: 'closed', origin: 'human' }))).toBe(
      'status=closed&suppressedReason=none',
    );
    expect(buildQueueFilterQuery(at({ status: 'closed', origin: 'auto' }))).toBe(
      'status=closed&suppressedReason=any',
    );
    expect(buildQueueFilterQuery(at({ status: 'closed', origin: 'auto_reply' }))).toBe(
      'status=closed&suppressedReason=auto_reply',
    );
    expect(buildQueueFilterQuery(at({ status: 'spam', origin: 'spam_sender' }))).toBe(
      'status=spam&suppressedReason=spam_sender',
    );
  });

  it('keeps spam out of every filtered or searched list unless the status filter asks for it', () => {
    expect(buildQueueFilterQuery(at({ channelType: 'email' }))).toBe(
      'channelType=email&excludeStatus=spam',
    );
    expect(buildQueueFilterQuery(at({ origin: 'auto' }))).toBe(
      'suppressedReason=any&excludeStatus=spam',
    );
    expect(buildQueueFilterQuery(DEFAULT_QUEUE_FILTERS, Date.now(), 'payslip')).toBe(
      'q=payslip&excludeStatus=spam',
    );
    expect(buildQueueFilterQuery(at({ status: 'spam', channelType: 'email' }))).toBe(
      'status=spam&channelType=email',
    );
    expect(buildQueueFilterQuery(at({ status: 'open', channelType: 'email' }))).toBe(
      'status=open&channelType=email',
    );
  });

  it('turns a relative window into the absolute timestamp the API expects', () => {
    const now = Date.parse('2026-09-14T12:00:00.000Z');
    expect(buildQueueFilterQuery(at({ status: 'open', since: '1d' }), now)).toBe(
      'status=open&since=2026-09-13T12%3A00%3A00.000Z',
    );
    expect(buildQueueFilterQuery(at({ status: 'open', since: '30d' }), now)).toBe(
      'status=open&since=2026-08-15T12%3A00%3A00.000Z',
    );
  });

  it('appends the trimmed search term so the server, not the loaded page, does the matching', () => {
    expect(buildQueueFilterQuery(at({ status: 'open' }), Date.now(), '  payslip  ')).toBe(
      'status=open&q=payslip',
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

describe('withQueueOrigin', () => {
  it('switches the status to spam when junk senders are picked, so the receipt shows why spam appears', () => {
    expect(withQueueOrigin(DEFAULT_QUEUE_FILTERS, 'spam_sender')).toEqual(
      at({ origin: 'spam_sender', status: 'spam' }),
    );
  });

  it('leaves a status the operator already chose alone', () => {
    expect(withQueueOrigin(at({ status: 'closed' }), 'spam_sender')).toEqual(
      at({ origin: 'spam_sender', status: 'closed' }),
    );
  });

  it('changes only the origin for every other option', () => {
    expect(withQueueOrigin(at({ channelType: 'email' }), 'auto')).toEqual(
      at({ channelType: 'email', origin: 'auto' }),
    );
    expect(withQueueOrigin(at({ status: 'spam', origin: 'spam_sender' }), 'any')).toEqual(
      at({ status: 'spam' }),
    );
  });
});
