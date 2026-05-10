export type InboxPreviewKind = 'conv' | 'kb' | 'crm' | 'out';

export interface InboxPreviewRow {
  id: string;
  kind: InboxPreviewKind;
  pillLabel: string;
  who: string;
  subject: string;
  timestamp: string;
  live: boolean;
}

interface LiveSummary {
  id: string;
  subject: string | null;
  endUserId: string | null;
  needsHumanAttention: boolean;
  needsHumanAttentionAt: string | null;
  lastMessageAt: string | null;
  updatedAt: string;
  latestEndUserMessage: { body: string; createdAt: string } | null;
}

interface KbCandidate {
  id: string;
  title: string;
  proposedTargetSpaceSlug: string | null;
  updatedAt: string;
}

interface CrmContactSummary {
  id: string;
  name: string | null;
  email: string | null;
}

interface CrmMergeProposal {
  id: string;
  contactA: CrmContactSummary;
  contactB: CrmContactSummary;
  confidence: 'high' | 'medium';
  createdAt: string;
}

interface OutreachProposal {
  id: string;
  draftSubject: string | null;
  campaign?: { name: string } | null;
  contact?: { name: string | null; email: string | null } | null;
  createdAt: string;
}

export interface InboxQueueShape {
  live: LiveSummary[];
  queue: {
    kb: KbCandidate[];
    crm: CrmMergeProposal[];
    outreach: OutreachProposal[];
  };
}

const contactLabel = (c: CrmContactSummary) => c.name ?? c.email ?? c.id;

const liveToRow = (c: LiveSummary): InboxPreviewRow => ({
  id: `live:${c.id}`,
  kind: 'conv',
  pillLabel: 'conversation',
  who: c.endUserId ?? 'end-user',
  subject: c.subject ?? c.latestEndUserMessage?.body.slice(0, 80) ?? 'New conversation',
  timestamp: c.needsHumanAttentionAt ?? c.lastMessageAt ?? c.updatedAt,
  live: true,
});

const kbToRow = (k: KbCandidate): InboxPreviewRow => ({
  id: `kb:${k.id}`,
  kind: 'kb',
  pillLabel: 'kb',
  who: k.proposedTargetSpaceSlug ? `for ${k.proposedTargetSpaceSlug}` : 'kb candidate',
  subject: k.title,
  timestamp: k.updatedAt,
  live: false,
});

const crmToRow = (c: CrmMergeProposal): InboxPreviewRow => ({
  id: `crm:${c.id}`,
  kind: 'crm',
  pillLabel: 'crm',
  who: `${c.confidence} confidence`,
  subject: `${contactLabel(c.contactA)} ↔ ${contactLabel(c.contactB)}`,
  timestamp: c.createdAt,
  live: false,
});

const outreachToRow = (o: OutreachProposal): InboxPreviewRow => ({
  id: `out:${o.id}`,
  kind: 'out',
  pillLabel: 'outreach',
  who: o.contact?.email ?? o.contact?.name ?? o.campaign?.name ?? 'draft',
  subject: o.draftSubject ?? o.campaign?.name ?? 'Outreach draft',
  timestamp: o.createdAt,
  live: false,
});

export function mergeInboxPreview(
  inbox: InboxQueueShape | null,
  limit: number,
): InboxPreviewRow[] {
  if (!inbox) return [];
  const rows: InboxPreviewRow[] = [
    ...inbox.live.map(liveToRow),
    ...inbox.queue.kb.map(kbToRow),
    ...inbox.queue.crm.map(crmToRow),
    ...inbox.queue.outreach.map(outreachToRow),
  ];
  rows.sort((a, b) => {
    if (a.live !== b.live) return a.live ? -1 : 1;
    return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
  });
  return rows.slice(0, limit);
}

export function totalInboxCount(inbox: InboxQueueShape | null): number {
  if (!inbox) return 0;
  return (
    inbox.live.length +
    inbox.queue.kb.length +
    inbox.queue.crm.length +
    inbox.queue.outreach.length
  );
}

export function formatRelativeAge(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const seconds = Math.max(0, Math.floor((now.getTime() - then) / 1000));
  if (seconds < 60) return 'now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.floor(days / 7);
  return `${weeks}w`;
}
