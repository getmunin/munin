import { describe, expect, it } from 'vitest';
import type { ConversationSummary } from './api.ts';
import { inboxUnread, markInboxSeen, nextInboxNotice } from './inbox.ts';

const conv = (id: string, sessionId: string, unreadCount: number, lastMessageAt: string): ConversationSummary => ({
  id,
  sessionId,
  title: id,
  preview: `preview ${id}`,
  status: 'open',
  handedOver: false,
  lastMessageAt,
  unreadCount,
});

describe('inbox', () => {
  const list = [
    conv('current', 's_current', 4, '2026-10-27T10:00:00Z'),
    conv('older', 'srv_a', 1, '2026-10-26T10:00:00Z'),
    conv('newer', 'srv_b', 2, '2026-10-27T09:00:00Z'),
    conv('read', 'srv_c', 0, '2026-10-27T11:00:00Z'),
  ];

  it('counts unread messages in conversations other than the open one', () => {
    expect(inboxUnread(list, 's_current')).toBe(3);
  });

  it('offers the newest unread conversation once, and again only when it gets a new message', () => {
    expect(nextInboxNotice(list, 's_current')?.id).toBe('newer');
    markInboxSeen(list[2]!);
    expect(nextInboxNotice(list, 's_current')?.id).toBe('older');
    const updated = [conv('newer', 'srv_b', 3, '2026-10-27T12:00:00Z')];
    expect(nextInboxNotice(updated, 's_current')?.id).toBe('newer');
  });
});
