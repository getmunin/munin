import { describe, expect, it } from 'vitest';
import {
  FINISHED_MIN_ITEMS,
  FINISHED_WINDOW_DAYS,
  matchesQueueSearch,
  messageDraftKind,
  partitionQueue,
  visibleFinished,
  type QueueItemDto,
} from './conversation-queue';
import type { MessageDto } from './inbox-types';

function item(overrides: Partial<QueueItemDto>): QueueItemDto {
  return {
    id: 'cnv_1',
    displayId: 1,
    status: 'open',
    channelId: 'cch_1',
    channelType: 'chat',
    endUserId: 'eu_1',
    contactId: null,
    topicId: null,
    assigneeUserId: null,
    subject: 'Payslip upload keeps failing',
    lastMessageAt: new Date().toISOString(),
    lastInboundPreview: 'Tried three times…',
    needsHumanAttention: false,
    needsHumanAttentionAt: null,
    agentMode: 'draft_only',
    customerName: 'Anders Vik',
    customerEmail: 'anders@example.com',
    topicName: null,
    topicSlug: null,
    topicAgentMode: null,
    claim: null,
    noteCount: 0,
    hasPendingDraft: false,
    ...overrides,
  };
}

describe('partitionQueue', () => {
  it('needs-you holds attention rows that are unclaimed or mine; the rest stay in progress', () => {
    const mine = item({ id: 'a', needsHumanAttention: true, claim: { holderId: 'me', holderName: 'Me', expiresAt: '' } });
    const free = item({ id: 'b', needsHumanAttention: true });
    const theirs = item({ id: 'c', needsHumanAttention: true, claim: { holderId: 'other', holderName: 'S. Krogh', expiresAt: '' } });
    const calm = item({ id: 'd' });
    const sections = partitionQueue([mine, free, theirs, calm], [item({ id: 'e', status: 'closed' })], 'me');
    expect(sections.needsYou.map((i) => i.id)).toEqual(['a', 'b']);
    expect(sections.inProgress.map((i) => i.id)).toEqual(['c', 'd']);
    expect(sections.finished.map((i) => i.id)).toEqual(['e']);
  });

  it('anything you claimed stays with you, even while the customer is the one who owes a reply', () => {
    const mineAwaiting = item({
      id: 'a',
      endUserSpokeLast: true,
      claim: { holderId: 'me', holderName: 'Me', expiresAt: '' },
    });
    const mineAnswered = item({
      id: 'b',
      endUserSpokeLast: false,
      claim: { holderId: 'me', holderName: 'Me', expiresAt: '' },
    });
    const theirsAwaiting = item({
      id: 'c',
      endUserSpokeLast: true,
      claim: { holderId: 'other', holderName: 'S. Krogh', expiresAt: '' },
    });
    const freeAwaiting = item({ id: 'd', endUserSpokeLast: true });
    const sections = partitionQueue([mineAwaiting, mineAnswered, theirsAwaiting, freeAwaiting], [], 'me');
    expect(sections.needsYou.map((i) => i.id)).toEqual(['a', 'b']);
    expect(sections.inProgress.map((i) => i.id)).toEqual(['c', 'd']);
  });

  it('keeps a claim of yours in needs-you even after the attention flag is cleared', () => {
    const mineCalm = item({
      id: 'a',
      needsHumanAttention: false,
      endUserSpokeLast: false,
      claim: { holderId: 'me', holderName: 'Me', expiresAt: '' },
    });
    const sections = partitionQueue([mineCalm], [], 'me');
    expect(sections.needsYou.map((i) => i.id)).toEqual(['a']);
    expect(sections.inProgress).toHaveLength(0);
  });

  it('a flagged conversation someone else holds is theirs to finish, not yours', () => {
    const theirs = item({
      id: 'a',
      needsHumanAttention: true,
      claim: { holderId: 'other', holderName: 'S. Krogh', expiresAt: '' },
    });
    const sections = partitionQueue([theirs], [], 'me');
    expect(sections.needsYou).toHaveLength(0);
    expect(sections.inProgress.map((i) => i.id)).toEqual(['a']);
  });
});

describe('matchesQueueSearch', () => {
  it('matches customer, subject, preview and topic case-insensitively', () => {
    const row = item({ topicName: 'Document requests' });
    expect(matchesQueueSearch(row, 'ANDERS')).toBe(true);
    expect(matchesQueueSearch(row, 'payslip')).toBe(true);
    expect(matchesQueueSearch(row, 'document req')).toBe(true);
    expect(matchesQueueSearch(row, 'refinancing')).toBe(false);
    expect(matchesQueueSearch(row, '  ')).toBe(true);
  });
});

describe('messageDraftKind', () => {
  const base: MessageDto = {
    id: 'm1',
    conversationId: 'cnv_1',
    authorType: 'agent',
    authorId: 'agt',
    authorName: null,
    body: 'draft',
    internal: true,
    inReplyToId: null,
    attachments: [],
    metadata: { kind: 'draft_reply' },
    createdAt: new Date().toISOString(),
  };

  it('classifies every draft lifecycle kind including rejected', () => {
    for (const kind of ['draft_reply', 'draft_reply_sent', 'draft_reply_superseded', 'draft_reply_rejected']) {
      expect(messageDraftKind({ ...base, metadata: { kind } })).toBe(kind);
    }
  });

  it('leaves notes and public messages alone', () => {
    expect(messageDraftKind({ ...base, metadata: { kind: 'internal_note' } })).toBeNull();
    expect(messageDraftKind({ ...base, internal: false, metadata: {} })).toBeNull();
    expect(messageDraftKind({ ...base, authorType: 'user', metadata: { kind: 'draft_reply' } })).toBeNull();
  });
});

describe('visibleFinished', () => {
  const NOW = Date.parse('2026-09-02T12:00:00.000Z');
  const daysAgo = (days: number) => new Date(NOW - days * 24 * 60 * 60 * 1000).toISOString();

  function closedRun(count: number, ageDays: number): QueueItemDto[] {
    return Array.from({ length: count }, (_, i) =>
      item({ id: `c${ageDays}_${i}`, status: 'closed', lastMessageAt: daysAgo(ageDays) }),
    );
  }

  it('keeps everything inside the window even when that is more than the minimum', () => {
    const kept = visibleFinished(closedRun(FINISHED_MIN_ITEMS + 20, 2), NOW);
    expect(kept).toHaveLength(FINISHED_MIN_ITEMS + 20);
  });

  it('keeps the minimum even when every row is older than the window', () => {
    const kept = visibleFinished(closedRun(FINISHED_MIN_ITEMS + 20, FINISHED_WINDOW_DAYS + 30), NOW);
    expect(kept).toHaveLength(FINISHED_MIN_ITEMS);
  });

  it('drops rows that are both past the window and past the minimum', () => {
    const recent = closedRun(3, 1);
    const stale = closedRun(40, FINISHED_WINDOW_DAYS + 1);
    const kept = visibleFinished([...recent, ...stale], NOW);
    expect(kept).toHaveLength(FINISHED_MIN_ITEMS);
    expect(kept.slice(0, 3)).toEqual(recent);
  });

  it('treats a row exactly on the window edge as inside it', () => {
    const padding = closedRun(FINISHED_MIN_ITEMS, 0);
    const edge = item({
      id: 'edge',
      status: 'closed',
      lastMessageAt: new Date(NOW - FINISHED_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString(),
    });
    expect(visibleFinished([...padding, edge], NOW).map((c) => c.id)).toContain('edge');
  });

  it('drops an undated row past the minimum rather than guessing it is recent', () => {
    const padding = closedRun(FINISHED_MIN_ITEMS, 0);
    const undated = item({ id: 'undated', status: 'closed', lastMessageAt: null });
    expect(visibleFinished([...padding, undated], NOW).map((c) => c.id)).not.toContain('undated');
  });

  it('is applied by partitionQueue, so the Done section is already trimmed', () => {
    const finished = closedRun(FINISHED_MIN_ITEMS + 10, FINISHED_WINDOW_DAYS + 5);
    expect(partitionQueue([], finished, 'me').finished).toHaveLength(FINISHED_MIN_ITEMS);
  });
});
