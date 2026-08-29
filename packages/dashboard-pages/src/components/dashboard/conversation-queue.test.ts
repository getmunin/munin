import { describe, expect, it } from 'vitest';
import {
  matchesQueueSearch,
  messageDraftKind,
  partitionQueue,
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

  it('a conversation you claimed where the customer spoke last is waiting on you', () => {
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
    expect(sections.needsYou.map((i) => i.id)).toEqual(['a']);
    expect(sections.inProgress.map((i) => i.id)).toEqual(['b', 'c', 'd']);
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
