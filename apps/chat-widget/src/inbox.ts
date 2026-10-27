import type { ConversationSummary } from './api.ts';

const SEEN_PREFIX = 'munin-inbox-seen:';
const memory = new Set<string>();

export function inboxUnread(conversations: readonly ConversationSummary[], currentSessionId: string): number {
  return conversations
    .filter((c) => c.sessionId !== currentSessionId)
    .reduce((sum, c) => sum + (c.unreadCount ?? 0), 0);
}

export function nextInboxNotice(
  conversations: readonly ConversationSummary[],
  currentSessionId: string,
): ConversationSummary | null {
  const waiting = conversations
    .filter((c) => c.sessionId !== currentSessionId && (c.unreadCount ?? 0) > 0 && !isInboxSeen(c))
    .sort((a, b) => (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? ''));
  return waiting[0] ?? null;
}

export function markInboxSeen(conversation: ConversationSummary): void {
  const key = seenKey(conversation);
  memory.add(key);
  try {
    localStorage.setItem(key, '1');
  } catch {
    return;
  }
}

function isInboxSeen(conversation: ConversationSummary): boolean {
  const key = seenKey(conversation);
  if (memory.has(key)) return true;
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function seenKey(conversation: ConversationSummary): string {
  return `${SEEN_PREFIX}${conversation.id}:${conversation.lastMessageAt ?? ''}`;
}
