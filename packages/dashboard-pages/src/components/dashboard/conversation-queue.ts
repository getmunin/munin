import type { ConversationSummary, LiveSummary } from './inbox-types';

export type QueueSectionKey = 'needsYou' | 'inProgress' | 'open';

export type ConversationListItem = ConversationSummary;

export interface QueueRowModel {
  id: string;
  displayId: number;
  channelType: string | null;
  subject: string | null;
  who: string | null;
  preview: string | null;
  at: string;
  assigneeUserId: string | null;
  needsHumanAttention: boolean;
}

export interface ConversationQueueSection {
  key: QueueSectionKey;
  rows: QueueRowModel[];
}

function rowAt(item: ConversationListItem): string {
  return item.needsHumanAttentionAt ?? item.lastMessageAt ?? item.updatedAt;
}

export function toRow(item: ConversationListItem): QueueRowModel {
  return {
    id: item.id,
    displayId: item.displayId,
    channelType: item.channelType ?? null,
    subject: item.subject,
    who: item.endUserId,
    preview: item.lastInboundPreview ?? null,
    at: rowAt(item),
    assigneeUserId: item.assigneeUserId,
    needsHumanAttention: item.needsHumanAttention,
  };
}

export function liveToRow(live: LiveSummary): QueueRowModel {
  return {
    id: live.id,
    displayId: live.displayId,
    channelType: live.channelType ?? null,
    subject: live.subject,
    who: live.endUserId ?? null,
    preview: live.latestEndUserMessage?.body ?? null,
    at: live.needsHumanAttentionAt ?? live.lastMessageAt ?? live.updatedAt,
    assigneeUserId: live.claim ? live.claim.holderId : null,
    needsHumanAttention: true,
  };
}

function byRecency(a: QueueRowModel, b: QueueRowModel): number {
  return Date.parse(b.at) - Date.parse(a.at);
}

export function matchesQuery(row: QueueRowModel, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === '') return true;
  return [row.who, row.subject, row.preview, `#${row.displayId}`].some(
    (field) => field != null && field.toLowerCase().includes(q),
  );
}

export function buildQueueSections({
  live,
  list,
  query,
}: {
  live: LiveSummary[];
  list: ConversationListItem[];
  query: string;
}): ConversationQueueSection[] {
  const needsYou = live.map(liveToRow);
  const seen = new Set(needsYou.map((r) => r.id));

  const inProgress: QueueRowModel[] = [];
  const open: QueueRowModel[] = [];

  for (const item of list) {
    if (seen.has(item.id)) continue;
    if (item.needsHumanAttention) {
      needsYou.push(toRow(item));
      seen.add(item.id);
      continue;
    }
    seen.add(item.id);
    (item.assigneeUserId ? inProgress : open).push(toRow(item));
  }

  return (
    [
      { key: 'needsYou' as const, rows: needsYou },
      { key: 'inProgress' as const, rows: inProgress },
      { key: 'open' as const, rows: open },
    ] satisfies ConversationQueueSection[]
  )
    .map((section) => ({
      key: section.key,
      rows: section.rows.filter((row) => matchesQuery(row, query)).sort(byRecency),
    }))
    .filter((section) => section.rows.length > 0);
}

export function firstRowId(sections: ConversationQueueSection[]): string | null {
  for (const section of sections) {
    const first = section.rows[0];
    if (first) return first.id;
  }
  return null;
}
