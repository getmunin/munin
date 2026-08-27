import { describe, it, expect } from 'vitest';
import {
  buildQueueSections,
  firstRowId,
  matchesQuery,
  toRow,
  type ConversationListItem,
} from './conversation-queue';
import type { LiveSummary } from './inbox-types';

function item(overrides: Partial<ConversationListItem> = {}): ConversationListItem {
  return {
    id: 'ccv_1',
    displayId: 1,
    status: 'open',
    channelId: 'chn_1',
    endUserId: 'anders@example.com',
    contactId: null,
    topicId: null,
    assigneeUserId: null,
    subject: 'Payslip upload keeps failing',
    lastMessageAt: '2026-08-27T09:00:00.000Z',
    needsHumanAttention: false,
    needsHumanAttentionAt: null,
    updatedAt: '2026-08-27T09:00:00.000Z',
    createdAt: '2026-08-27T08:00:00.000Z',
    ...overrides,
  };
}

function live(overrides: Partial<LiveSummary> = {}): LiveSummary {
  return {
    ...item({ needsHumanAttention: true, needsHumanAttentionAt: '2026-08-27T09:50:00.000Z' }),
    latestEndUserMessage: { body: 'It is a scan, around 14 MB.', createdAt: '2026-08-27T09:52:00Z' },
    claim: null,
    ...overrides,
  };
}

describe('buildQueueSections', () => {
  it('splits assigned from unassigned once attention is not the question', () => {
    const sections = buildQueueSections({
      live: [],
      list: [
        item({ id: 'a', assigneeUserId: 'usr_1' }),
        item({ id: 'b', assigneeUserId: null }),
      ],
      query: '',
    });
    expect(sections.map((s) => s.key)).toEqual(['inProgress', 'open']);
    expect(sections[0]!.rows.map((r) => r.id)).toEqual(['a']);
    expect(sections[1]!.rows.map((r) => r.id)).toEqual(['b']);
  });

  it('never lists a conversation twice when it is both live and in the page', () => {
    const sections = buildQueueSections({
      live: [live({ id: 'dup' })],
      list: [item({ id: 'dup', needsHumanAttention: true })],
      query: '',
    });
    const ids = sections.flatMap((s) => s.rows.map((r) => r.id));
    expect(ids).toEqual(['dup']);
  });

  it('prefers the live copy, which is the one carrying a message preview', () => {
    const sections = buildQueueSections({
      live: [live({ id: 'dup' })],
      list: [item({ id: 'dup', needsHumanAttention: true, lastInboundPreview: 'from the list' })],
      query: '',
    });
    expect(sections[0]!.rows[0]!.preview).toBe('It is a scan, around 14 MB.');
  });

  it('routes an attention-flagged list row to needsYou even when it is assigned', () => {
    const sections = buildQueueSections({
      live: [],
      list: [item({ id: 'a', needsHumanAttention: true, assigneeUserId: 'usr_1' })],
      query: '',
    });
    expect(sections.map((s) => s.key)).toEqual(['needsYou']);
  });

  it('drops a section that has no rows rather than rendering an empty heading', () => {
    const sections = buildQueueSections({ live: [], list: [], query: '' });
    expect(sections).toEqual([]);
  });

  it('sorts each section newest first', () => {
    const sections = buildQueueSections({
      live: [],
      list: [
        item({ id: 'older', lastMessageAt: '2026-08-27T08:00:00.000Z' }),
        item({ id: 'newer', lastMessageAt: '2026-08-27T10:00:00.000Z' }),
      ],
      query: '',
    });
    expect(sections[0]!.rows.map((r) => r.id)).toEqual(['newer', 'older']);
  });

  it('filters every section by the query and drops the ones left empty', () => {
    const sections = buildQueueSections({
      live: [live({ id: 'l', subject: 'Payslip upload' })],
      list: [item({ id: 'a', assigneeUserId: 'usr_1', subject: 'Rate differs' })],
      query: 'payslip',
    });
    expect(sections.map((s) => s.key)).toEqual(['needsYou']);
  });
});

describe('matchesQuery', () => {
  const row = toRow(item({ displayId: 47512, endUserId: 'ingrid@example.com' }));

  it('matches on customer, subject and preview, case-insensitively', () => {
    expect(matchesQuery(row, 'INGRID')).toBe(true);
    expect(matchesQuery(row, 'payslip')).toBe(true);
  });

  it('matches on the display id with its hash', () => {
    expect(matchesQuery(row, '#47512')).toBe(true);
  });

  it('treats a blank or whitespace query as no filter', () => {
    expect(matchesQuery(row, '')).toBe(true);
    expect(matchesQuery(row, '   ')).toBe(true);
  });

  it('does not match unrelated text', () => {
    expect(matchesQuery(row, 'refinancing')).toBe(false);
  });
});

describe('firstRowId', () => {
  it('picks the first row of the first non-empty section for the desktop pane', () => {
    const sections = buildQueueSections({
      live: [],
      list: [item({ id: 'a', assigneeUserId: 'usr_1' }), item({ id: 'b' })],
      query: '',
    });
    expect(firstRowId(sections)).toBe('a');
  });

  it('is null when nothing is listed', () => {
    expect(firstRowId([])).toBeNull();
  });
});
