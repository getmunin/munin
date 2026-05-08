'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, MessageSquare, ShieldCheck, Unplug } from 'lucide-react';
import ReactMarkdown, { type Components } from 'react-markdown';
import {
  Button,
  Card,
  CardContent,
  Hero,
  Pill,
  Sheet,
  SheetContent,
  cn,
} from '@getmunin/ui';
import { api, ApiError } from '../api';
import { useRealtime, type SubscriptionChannel } from '../realtime';

type Status = 'open' | 'snoozed' | 'closed' | 'spam';

interface ConversationSummary {
  id: string;
  displayId: number;
  status: Status;
  channelId: string;
  endUserId: string | null;
  contactId: string | null;
  topicId: string | null;
  assigneeUserId: string | null;
  subject: string | null;
  lastMessageAt: string | null;
  needsHumanAttention: boolean;
  needsHumanAttentionAt: string | null;
  updatedAt: string;
  createdAt: string;
}

interface MessageDto {
  id: string;
  conversationId: string;
  authorType: 'user' | 'agent' | 'end_user' | 'system';
  authorId: string;
  body: string;
  internal: boolean;
  inReplyToId: string | null;
  attachments: unknown[];
  createdAt: string;
}

interface ConversationDetail extends ConversationSummary {
  messages: MessageDto[];
  claim: { holderType: 'user' | 'agent'; holderId: string; expiresAt: string } | null;
}

interface ActivityDto {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

interface KbCandidateDto {
  id: string;
  title: string;
  body?: string;
  updatedAt: string;
  proposedTargetSpaceSlug: string | null;
}

interface CrmContactSummary {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
}

interface CrmMergeProposalDto {
  id: string;
  contactA: CrmContactSummary;
  contactB: CrmContactSummary;
  confidence: 'high' | 'medium';
  recommendedKeeperId: string;
  evidence?: Record<string, unknown>;
  createdAt: string;
}

interface OutreachProposalDto {
  id: string;
  campaignId: string;
  contactId: string;
  conversationId: string | null;
  kind: 'initial' | 'reply';
  draftSubject: string | null;
  draftBody: string;
  campaign?: { name: string } | null;
  contact?: { name: string | null; email: string | null } | null;
  evidence?: Record<string, unknown>;
  createdAt: string;
}

type QueueItem =
  | { kind: 'kb'; id: string; title: string; snippet: string; createdAt: string; raw: KbCandidateDto }
  | { kind: 'crm'; id: string; title: string; snippet: string; createdAt: string; raw: CrmMergeProposalDto }
  | { kind: 'outreach'; id: string; title: string; snippet: string; createdAt: string; raw: OutreachProposalDto };

type ConvDrawer = { id: string; mode: 'simplified' | 'full' } | null;

type LiveSummary = ConversationSummary & {
  latestEndUserMessage: { body: string; createdAt: string } | null;
  claim: ConversationDetail['claim'];
};

interface InboxQueueResponse {
  live: LiveSummary[];
  queue: {
    kb: KbCandidateDto[];
    crm: CrmMergeProposalDto[];
    outreach: OutreachProposalDto[];
  };
}

const kbToQueueItem = (k: KbCandidateDto): QueueItem => ({
  kind: 'kb',
  id: k.id,
  title: k.title,
  snippet: k.proposedTargetSpaceSlug ? `Proposed for ${k.proposedTargetSpaceSlug}.` : 'KB candidate.',
  createdAt: k.updatedAt,
  raw: k,
});

const contactLabel = (c: CrmContactSummary) => c.name ?? c.email ?? c.id;

const crmToQueueItem = (c: CrmMergeProposalDto): QueueItem => ({
  kind: 'crm',
  id: c.id,
  title: `${contactLabel(c.contactA)} ↔ ${contactLabel(c.contactB)}`,
  snippet: `${c.confidence} confidence — proposed merge.`,
  createdAt: c.createdAt,
  raw: c,
});

const outreachToQueueItem = (o: OutreachProposalDto): QueueItem => ({
  kind: 'outreach',
  id: o.id,
  title: o.draftSubject ?? o.campaign?.name ?? 'Outreach draft',
  snippet: o.contact?.email
    ? `${o.contact.email} — ${o.draftBody.slice(0, 80)}`
    : o.draftBody.slice(0, 100),
  createdAt: o.createdAt,
  raw: o,
});

function buildQueue(q: InboxQueueResponse['queue']): QueueItem[] {
  return [
    ...q.kb.map(kbToQueueItem),
    ...q.crm.map(crmToQueueItem),
    ...q.outreach.map(outreachToQueueItem),
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

/** Build a stub `ConversationDetail` from a live summary's embedded preview, so
 *  the live card can render without a per-conv fan-out detail fetch. */
function liveToStubDetail(c: LiveSummary): ConversationDetail {
  const latest = c.latestEndUserMessage;
  return {
    ...c,
    claim: c.claim,
    messages: latest
      ? [
          {
            id: `latest-${c.id}`,
            conversationId: c.id,
            authorType: 'end_user',
            authorId: c.endUserId ?? 'end_user',
            body: latest.body,
            internal: false,
            inReplyToId: null,
            attachments: [],
            createdAt: latest.createdAt,
          },
        ]
      : [],
  };
}

/** Merge live previews into the cached details map. If we already have a full
 *  detail (e.g. drawer was opened), keep its richer message thread but refresh
 *  the live fields (claim, needsHumanAttention, …). */
function mergeLive(
  prev: Record<string, ConversationDetail>,
  live: LiveSummary[],
): Record<string, ConversationDetail> {
  const next = { ...prev };
  for (const c of live) {
    const existing = next[c.id];
    next[c.id] = existing ? { ...existing, ...c, claim: c.claim } : liveToStubDetail(c);
  }
  return next;
}

export function InboxPage() {
  const [items, setItems] = useState<ConversationSummary[]>([]);
  const [details, setDetails] = useState<Record<string, ConversationDetail>>({});
  const [convDrawer, setConvDrawer] = useState<ConvDrawer>(null);
  const [queueDrawer, setQueueDrawer] = useState<QueueItem | null>(null);
  const [reply, setReply] = useState('');
  const [draftEdit, setDraftEdit] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [kbBodies, setKbBodies] = useState<Record<string, string>>({});

  const loadInbox = useCallback(async () => {
    try {
      const res = await api<InboxQueueResponse>('/api/inbox/queue');
      setItems(res.live);
      setDetails((prev) => mergeLive(prev, res.live));
      setQueue(buildQueue(res.queue));
      setError(null);
    } catch (err) {
      setError(messageOf(err));
    }
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    try {
      const d = await api<ConversationDetail>(`/api/conversations/${id}`);
      setDetails((prev) => ({ ...prev, [id]: d }));
    } catch (err) {
      setError(messageOf(err));
    }
  }, []);

  useEffect(() => {
    void loadInbox();
  }, [loadInbox]);

  useEffect(() => {
    if (!convDrawer) return;
    void loadDetail(convDrawer.id);
  }, [convDrawer, loadDetail]);

  useEffect(() => {
    if (!queueDrawer || queueDrawer.kind !== 'kb') return;
    if (kbBodies[queueDrawer.id] !== undefined) return;
    void api<KbCandidateDto & { body: string }>(
      `/api/kb/curation/candidates/${queueDrawer.id}`,
    )
      .then((doc) => setKbBodies((prev) => ({ ...prev, [queueDrawer.id]: doc.body })))
      .catch(() => {
        /* swallow — drawer just shows the snippet fallback */
      });
  }, [queueDrawer, kbBodies]);

  const subscriptions = useMemo<SubscriptionChannel[]>(() => {
    const subs: SubscriptionChannel[] = [{ channel: 'org' }];
    if (convDrawer) subs.push({ channel: 'conversation', id: convDrawer.id });
    return subs;
  }, [convDrawer]);

  useRealtime(subscriptions, (event) => {
    const matches =
      event.type.startsWith('conversation.') ||
      event.type.startsWith('kb.') ||
      event.type.startsWith('crm.merge_proposal.') ||
      event.type.startsWith('outreach.proposal.');
    if (matches) void loadInbox();
    if (event.type.startsWith('conversation.')) {
      const eventConvId = event.payload['conversationId'];
      if (typeof eventConvId === 'string') void loadDetail(eventConvId);
    }
  });

  async function takeOver(id: string, openFullAfter = true) {
    setPending(true);
    try {
      await api(`/api/conversations/${id}/take-over`, { method: 'POST', body: '{}' });
      await Promise.all([loadDetail(id), loadInbox()]);
      if (openFullAfter) setConvDrawer({ id, mode: 'full' });
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setPending(false);
    }
  }

  async function release(id: string) {
    setPending(true);
    try {
      await api(`/api/conversations/${id}/release`, { method: 'POST', body: '{}' });
      await Promise.all([loadDetail(id), loadInbox()]);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setPending(false);
    }
  }

  async function closeConv(id: string) {
    setPending(true);
    try {
      await api(`/api/conversations/${id}/status`, {
        method: 'POST',
        body: JSON.stringify({ status: 'closed' }),
      });
      await Promise.all([loadDetail(id), loadInbox()]);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setPending(false);
    }
  }

  async function send(id: string, body: string) {
    if (!body.trim()) return;
    const trimmed = body.trim();
    const temp: MessageDto = {
      id: `pending-${Date.now()}`,
      conversationId: id,
      authorType: 'user',
      authorId: 'me',
      body: trimmed,
      internal: false,
      inReplyToId: null,
      attachments: [],
      createdAt: new Date().toISOString(),
    };
    setReply('');
    setDetails((prev) => {
      const d = prev[id];
      if (!d) return prev;
      return { ...prev, [id]: { ...d, messages: [...d.messages, temp] } };
    });
    setPending(true);
    try {
      await api(`/api/conversations/${id}/messages`, {
        method: 'POST',
        body: JSON.stringify({ body: trimmed }),
      });
      await Promise.all([loadDetail(id), loadInbox()]);
    } catch (err) {
      setError(messageOf(err));
      setDetails((prev) => {
        const d = prev[id];
        if (!d) return prev;
        return { ...prev, [id]: { ...d, messages: d.messages.filter((m) => m.id !== temp.id) } };
      });
      setReply(trimmed);
    } finally {
      setPending(false);
    }
  }

  async function approveQueue(item: QueueItem) {
    setPending(true);
    try {
      if (item.kind === 'kb') {
        const targetSlug = item.raw.proposedTargetSpaceSlug ?? 'support-faq';
        await api(`/api/kb/curation/candidates/${item.id}/publish`, {
          method: 'POST',
          body: JSON.stringify({ targetSpaceSlug: targetSlug }),
        });
      } else if (item.kind === 'crm') {
        await api(`/api/crm/merge-proposals/${item.id}/apply`, { method: 'POST' });
      } else {
        await api(`/api/outreach/proposals/${item.id}/approve`, { method: 'POST' });
      }
      await loadInbox();
      setQueueDrawer(null);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setPending(false);
    }
  }

  async function saveQueue(item: QueueItem, body: string) {
    setPending(true);
    try {
      if (item.kind === 'kb') {
        await api(`/api/kb/curation/candidates/${item.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ body }),
        });
        setKbBodies((prev) => ({ ...prev, [item.id]: body }));
      } else if (item.kind === 'outreach') {
        await api(`/api/outreach/proposals/${item.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ draftBody: body }),
        });
      }
      await loadInbox();
    } catch (err) {
      setError(messageOf(err));
      throw err;
    } finally {
      setPending(false);
    }
  }

  async function dismissQueue(item: QueueItem) {
    setPending(true);
    try {
      if (item.kind === 'kb') {
        await api(`/api/kb/curation/candidates/${item.id}`, { method: 'DELETE' });
      } else if (item.kind === 'crm') {
        await api(`/api/crm/merge-proposals/${item.id}/dismiss`, {
          method: 'POST',
          body: JSON.stringify({}),
        });
      } else {
        await api(`/api/outreach/proposals/${item.id}/dismiss`, {
          method: 'POST',
          body: JSON.stringify({}),
        });
      }
      await loadInbox();
      setQueueDrawer(null);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setPending(false);
    }
  }

  const liveItems = items;
  const selectedConv = convDrawer ? details[convDrawer.id] : null;

  return (
    <div className="px-10 py-10 max-w-7xl mx-auto space-y-10">
      <Hero
        eyebrow="01 — inbox"
        title={
          <>
            Word from the <em>flock.</em>
          </>
        }
        lede={
          liveItems.length > 0
            ? `${liveItems.length} ${liveItems.length === 1 ? 'live conversation is' : 'live conversations are'} paused on your reply. The rest can wait.`
            : 'All quiet. Drafts and conversations land here as they arrive.'
        }
      />

      {error && (
        <Card>
          <CardContent className="py-4 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      {liveItems.length > 0 && (
        <section className="bg-paper-deep -mx-10 px-10 py-6 dark:bg-secondary">
          <div className="flex items-center gap-3 mb-4">
            <span className="size-2 rounded-full bg-cobalt animate-pulse dark:bg-cobalt-soft" aria-hidden />
            <h2 className="font-mono text-[10px] uppercase tracking-eyebrow text-cobalt dark:text-cobalt-soft">
              Live now · {liveItems.length}
            </h2>
          </div>
          <ul className="space-y-3">
            {liveItems.map((c) => (
              <LiveCard
                key={c.id}
                conv={c}
                detail={details[c.id]}
                pending={pending}
                onOpen={(mode) => {
                  setReply('');
                  setDraftEdit(null);
                  setConvDrawer({ id: c.id, mode });
                }}
                onTakeOver={() => void takeOver(c.id, true)}
              />
            ))}
          </ul>
        </section>
      )}

      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute">
            Queue · {queue.length}
          </h2>
          <span className="font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute">
            sorted by recency
          </span>
        </div>
        <ul className="border-t border-rule-soft dark:border-rule-on-dark">
          {queue.map((q) => (
            <QueueRow
              key={`${q.kind}-${q.id}`}
              item={q}
              pending={pending}
              onOpen={() => setQueueDrawer(q)}
              onApprove={() => void approveQueue(q)}
              onDismiss={() => void dismissQueue(q)}
            />
          ))}
          {queue.length === 0 && (
            <li className="py-12 text-center text-sm text-ink-mute font-serif italic">
              Queue is <span className="text-cobalt dark:text-cobalt-soft">clear.</span>
            </li>
          )}
        </ul>
      </section>

      <Sheet
        open={convDrawer !== null}
        onOpenChange={(o) => {
          if (!o) {
            setConvDrawer(null);
            setDraftEdit(null);
          }
        }}
      >
        <SheetContent side="right" className="w-full max-w-[560px]">
          {convDrawer && selectedConv ? (
            convDrawer.mode === 'simplified' ? (
              <SimplifiedConvDrawer
                detail={selectedConv}
                pending={pending}
                draftEdit={draftEdit}
                setDraftEdit={setDraftEdit}
                onSendDraft={(body) => void send(selectedConv.id, body)}
                onTakeOver={() => void takeOver(selectedConv.id, true)}
                onClose={() => setConvDrawer(null)}
              />
            ) : (
              <FullConvDrawer
                detail={selectedConv}
                reply={reply}
                setReply={setReply}
                pending={pending}
                onSend={() => void send(selectedConv.id, reply)}
                onTakeOver={() => void takeOver(selectedConv.id, false)}
                onRelease={() => void release(selectedConv.id)}
                onCloseConv={() => void closeConv(selectedConv.id)}
                onClose={() => setConvDrawer(null)}
              />
            )
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-ink-mute">
              <MessageSquare className="mr-2 size-4" /> Loading…
            </div>
          )}
        </SheetContent>
      </Sheet>

      <Sheet open={queueDrawer !== null} onOpenChange={(o) => !o && setQueueDrawer(null)}>
        <SheetContent side="right" className="w-full max-w-[560px]">
          {queueDrawer && (
            <QueueDrawer
              item={queueDrawer}
              kbBody={queueDrawer.kind === 'kb' ? kbBodies[queueDrawer.id] : undefined}
              pending={pending}
              onApprove={() => void approveQueue(queueDrawer)}
              onDismiss={() => void dismissQueue(queueDrawer)}
              onSave={(body) => saveQueue(queueDrawer, body)}
              onClose={() => setQueueDrawer(null)}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function LiveCard({
  conv,
  detail,
  pending,
  onOpen,
  onTakeOver,
}: {
  conv: ConversationSummary;
  detail: ConversationDetail | undefined;
  pending: boolean;
  onOpen: (mode: 'simplified' | 'full') => void;
  onTakeOver: () => void;
}) {
  const claimed = detail?.claim != null;
  const lastEndUserMsg = detail?.messages
    .slice()
    .reverse()
    .find((m) => m.authorType === 'end_user');
  const who = conv.endUserId ?? `Conversation #${conv.displayId}`;
  const subject = conv.subject ?? `Conversation #${conv.displayId}`;
  const waiting = conv.needsHumanAttentionAt
    ? relative(conv.needsHumanAttentionAt)
    : conv.lastMessageAt
    ? relative(conv.lastMessageAt)
    : '';

  const handleCardClick = () => onOpen(claimed ? 'full' : 'simplified');

  return (
    <li>
      <div
        className="group/livecard flex items-stretch gap-4 border border-ink bg-paper px-5 py-4 cursor-pointer transition-colors duration-fast ease-munin hover:border-cobalt dark:border-rule-on-dark dark:bg-card dark:hover:border-cobalt-soft"
        onClick={handleCardClick}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleCardClick();
          }
        }}
      >
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute">
            <span className="text-ink dark:text-foreground">{who}</span>
            {claimed ? (
              <span className="text-cobalt dark:text-cobalt-soft">you · taken over</span>
            ) : (
              <span className="text-cobalt dark:text-cobalt-soft">waiting {waiting}</span>
            )}
          </div>
          <h3 className="font-serif text-xl leading-tight text-ink dark:text-foreground">
            {subject}
          </h3>
          {lastEndUserMsg && (
            <p className="border-l-2 border-cobalt pl-3 font-serif italic text-cobalt dark:border-cobalt-soft dark:text-cobalt-soft">
              &ldquo;{truncate(lastEndUserMsg.body, 160)}&rdquo;
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2" onClick={(e) => e.stopPropagation()}>
          {claimed ? (
            <Button variant="accent" size="sm" onClick={() => onOpen('full')}>
              Chat →
            </Button>
          ) : (
            <>
              <Button
                variant="accent"
                size="sm"
                onClick={() => onOpen('simplified')}
                disabled={pending}
              >
                Reply ↵
              </Button>
              <Button size="sm" onClick={onTakeOver} disabled={pending}>
                Take over →
              </Button>
            </>
          )}
        </div>
      </div>
    </li>
  );
}

function QueueRow({
  item,
  pending,
  onOpen,
  onApprove,
  onDismiss,
}: {
  item: QueueItem;
  pending: boolean;
  onOpen: () => void;
  onApprove: () => void;
  onDismiss: () => void;
}) {
  const tone: 'kb' | 'crm' | 'out' = item.kind === 'outreach' ? 'out' : item.kind;
  const label = item.kind === 'outreach' ? 'OUTREACH' : item.kind.toUpperCase();
  return (
    <li>
      <div
        className="group/qrow relative flex items-center gap-4 border-b border-rule-soft px-4 py-3 transition-colors duration-fast ease-munin hover:bg-paper-deep cursor-pointer dark:border-rule-on-dark dark:hover:bg-secondary"
        onClick={onOpen}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onOpen();
          }
        }}
      >
        <span className="shrink-0">
          <Pill tone={tone}>{label}</Pill>
        </span>
        <div className="min-w-0 flex-1">
          <span className="text-sm font-medium text-ink dark:text-foreground">{item.title}</span>
          <span className="ml-2 text-sm text-ink-mute"> — {item.snippet}</span>
        </div>
        <span className="shrink-0 font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute opacity-100 transition-opacity duration-fast ease-munin group-hover/qrow:opacity-0">
          {relative(item.createdAt)}
        </span>
        <div
          className="absolute inset-y-0 right-3 flex items-center gap-2 opacity-0 transition-opacity duration-fast ease-munin group-hover/qrow:opacity-100 focus-within:opacity-100"
          onClick={(e) => e.stopPropagation()}
        >
          <Button
            variant="accent"
            size="sm"
            onClick={onApprove}
            disabled={pending}
          >
            Approve
          </Button>
          <Button variant="outline" size="sm" onClick={onDismiss} disabled={pending}>
            Dismiss
          </Button>
        </div>
      </div>
    </li>
  );
}

function SimplifiedConvDrawer({
  detail,
  pending,
  draftEdit,
  setDraftEdit,
  onSendDraft,
  onTakeOver,
  onClose,
}: {
  detail: ConversationDetail;
  pending: boolean;
  draftEdit: string | null;
  setDraftEdit: (v: string | null) => void;
  onSendDraft: (body: string) => void;
  onTakeOver: () => void;
  onClose: () => void;
}) {
  const customer = detail.messages
    .slice()
    .reverse()
    .find((m) => m.authorType === 'end_user' && !m.internal);
  const draft = detail.messages
    .slice()
    .reverse()
    .find((m) => m.authorType === 'agent' && !m.internal);

  const draftBody = draftEdit ?? draft?.body ?? '';
  const isEditing = draftEdit !== null;
  const waiting = detail.needsHumanAttentionAt ? relative(detail.needsHumanAttentionAt) : '';
  const who = detail.endUserId ?? `Conversation #${detail.displayId}`;

  useCmdEnter(() => {
    if (draftBody.trim() && !pending) onSendDraft(draftBody);
  });

  return (
    <>
      <DrawerHeader
        pillTone="live"
        pillLabel="conversation"
        title={detail.subject ?? `Conversation #${detail.displayId}`}
        meta={`${who} · waiting ${waiting}`}
        onClose={onClose}
      />

      <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
        {customer && (
          <section className="space-y-2">
            <p className="font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute">
              Customer
            </p>
            <p className="border-l-2 border-cobalt pl-3 font-serif italic text-cobalt dark:border-cobalt-soft dark:text-cobalt-soft">
              &ldquo;{customer.body}&rdquo;
            </p>
          </section>
        )}

        <section className="space-y-2">
          <p className="font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute">
            Agent's draft reply
          </p>
          {isEditing ? (
            <textarea
              value={draftBody}
              onChange={(e) => setDraftEdit(e.target.value)}
              rows={8}
              className="w-full rounded-input border border-ink bg-paper px-4 py-3 text-sm leading-relaxed outline-none focus-visible:border-cobalt focus-visible:ring-1 focus-visible:ring-cobalt dark:bg-card dark:border-rule-on-dark dark:text-foreground"
              autoFocus
            />
          ) : (
            <div className="border border-ink bg-paper px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap dark:bg-card dark:border-rule-on-dark dark:text-foreground">
              {draft ? draft.body : <span className="text-ink-mute italic">No draft yet.</span>}
            </div>
          )}
        </section>
      </div>

      <DrawerFooter
        primary={{
          label: 'Send draft ↵',
          onClick: () => onSendDraft(draftBody),
          disabled: pending || !draftBody.trim(),
        }}
        secondary={[
          isEditing
            ? { label: 'Cancel', onClick: () => setDraftEdit(null) }
            : {
                label: 'Edit',
                onClick: () => setDraftEdit(draft?.body ?? ''),
                disabled: !draft,
              },
          { label: 'Take over →', onClick: onTakeOver, disabled: pending },
        ]}
        shortcut="⌘↵ send"
      />
    </>
  );
}

function FullConvDrawer({
  detail,
  reply,
  setReply,
  pending,
  onSend,
  onTakeOver,
  onRelease,
  onCloseConv,
  onClose,
}: {
  detail: ConversationDetail;
  reply: string;
  setReply: (v: string) => void;
  pending: boolean;
  onSend: () => void;
  onTakeOver: () => void;
  onRelease: () => void;
  onCloseConv: () => void;
  onClose: () => void;
}) {
  const claimed = detail.claim !== null;

  useCmdEnter(() => {
    if (reply.trim() && !pending) onSend();
  });

  return (
    <>
      <DrawerHeader
        pillTone={detail.needsHumanAttention ? 'live' : detail.status === 'open' ? 'ink' : 'draft'}
        pillLabel={detail.needsHumanAttention ? 'live' : detail.status}
        title={detail.subject ?? `Conversation #${detail.displayId}`}
        meta={`${detail.endUserId ?? '—'} · ${detail.status}`}
        rightExtra={
          claimed ? (
            <Pill tone="review">
              <ShieldCheck className="size-3" /> taken over
            </Pill>
          ) : null
        }
        onClose={onClose}
      />

      <div className="flex-1 space-y-3 overflow-y-auto px-6 py-5">
        {detail.messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}
      </div>

      <ActivityRail contactId={detail.contactId} conversationId={detail.id} />

      <div className="border-t border-rule-soft p-4 dark:border-rule-on-dark">
        <textarea
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          rows={3}
          placeholder="Reply…"
          className="w-full rounded-input border border-rule-soft bg-paper px-3 py-2 text-sm outline-none focus-visible:border-cobalt focus-visible:ring-1 focus-visible:ring-cobalt dark:bg-card dark:border-rule-on-dark"
        />
        <div className="mt-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {!claimed ? (
              <Button size="sm" onClick={onTakeOver} disabled={pending}>
                Take over
              </Button>
            ) : (
              <Button size="sm" variant="outline" onClick={onRelease} disabled={pending}>
                <Unplug className="size-3.5" /> Release
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={onCloseConv} disabled={pending}>
              Close
            </Button>
          </div>
          <Button variant="accent" onClick={onSend} disabled={pending || !reply.trim()}>
            Send ↵
          </Button>
        </div>
      </div>
    </>
  );
}

const MD_COMPONENTS: Components = {
  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="mb-2 list-disc space-y-1 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="mb-2 list-decimal space-y-1 pl-5">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-ink dark:text-foreground">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  h1: ({ children }) => <p className="mb-2 font-serif text-base font-medium">{children}</p>,
  h2: ({ children }) => <p className="mb-2 font-serif text-base font-medium">{children}</p>,
  h3: ({ children }) => <p className="mb-2 font-serif text-base font-medium">{children}</p>,
  code: ({ children }) => <code className="font-mono text-xs bg-paper-deep px-1 py-0.5 dark:bg-secondary">{children}</code>,
  a: ({ href, children }) => (
    <a href={href} className="text-cobalt underline-offset-2 hover:underline dark:text-cobalt-soft">
      {children}
    </a>
  ),
};

function QueueDrawer({
  item,
  kbBody,
  pending,
  onApprove,
  onDismiss,
  onSave,
  onClose,
}: {
  item: QueueItem;
  kbBody?: string;
  pending: boolean;
  onApprove: () => void;
  onDismiss: () => void;
  onSave: (body: string) => Promise<void>;
  onClose: () => void;
}) {
  const initialBody =
    item.kind === 'outreach'
      ? item.raw.draftBody
      : item.kind === 'kb'
      ? (kbBody ?? '')
      : '';
  const [editing, setEditing] = useState(false);
  const [editedBody, setEditedBody] = useState<string>(initialBody);

  useEffect(() => {
    setEditing(false);
    setEditedBody(initialBody);
  }, [item.id, initialBody]);

  const tone: 'kb' | 'crm' | 'out' = item.kind === 'outreach' ? 'out' : item.kind;
  const label = item.kind === 'outreach' ? 'OUTREACH' : item.kind.toUpperCase();
  const editable = item.kind !== 'crm';

  const cancelEdit = useCallback(() => {
    setEditing(false);
    setEditedBody(initialBody);
  }, [initialBody]);

  const saveEdit = async () => {
    if (!editedBody.trim() || pending) return;
    await onSave(editedBody);
    setEditing(false);
  };

  useCmdEnter(() => {
    if (pending) return;
    if (editing) void saveEdit();
    else onApprove();
  });

  useEffect(() => {
    if (!editing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        cancelEdit();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing, cancelEdit]);

  let meta: string;
  if (item.kind === 'outreach') {
    const k = item.raw.kind === 'reply' ? 'REPLY' : 'INITIAL';
    const handle = item.raw.contact?.email ?? item.raw.campaign?.name ?? '—';
    meta = `${k} · ${handle} · ${relative(item.createdAt)}`;
  } else if (item.kind === 'crm') {
    meta = `Contacts ×2 · ${item.raw.confidence} · ${relative(item.createdAt)}`;
  } else {
    meta = `${item.raw.proposedTargetSpaceSlug ?? 'kb-curation-inbox'} · ${relative(item.createdAt)}`;
  }

  return (
    <>
      <DrawerHeader
        pillTone={tone}
        pillLabel={label}
        title={item.title}
        meta={meta}
        onClose={onClose}
      />

      <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
        {item.kind === 'outreach' && item.raw.kind === 'reply' && (
          <section className="space-y-2">
            <p className="font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute">
              Reply from
            </p>
            <p className="border-l-2 border-cobalt pl-3 font-serif italic text-cobalt dark:border-cobalt-soft dark:text-cobalt-soft">
              &ldquo;{item.snippet}&rdquo;
            </p>
          </section>
        )}

        <section className="space-y-2">
          <p className="font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute">Proposal</p>
          {editing ? (
            <textarea
              value={editedBody}
              onChange={(e) => setEditedBody(e.target.value)}
              rows={14}
              className="w-full resize-y rounded-input border border-cobalt bg-paper px-4 py-3 text-sm leading-relaxed outline-none focus-visible:ring-1 focus-visible:ring-cobalt dark:bg-card dark:text-foreground"
              autoFocus
            />
          ) : (
            <div className="border border-ink bg-paper px-4 py-3 text-sm leading-relaxed dark:bg-card dark:border-rule-on-dark dark:text-foreground">
              {item.kind === 'outreach' ? (
                <>
                  {item.raw.draftSubject && (
                    <p className="mb-2 font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute">
                      Subject — {item.raw.draftSubject}
                    </p>
                  )}
                  <ReactMarkdown components={MD_COMPONENTS}>{editedBody}</ReactMarkdown>
                </>
              ) : item.kind === 'crm' ? (
                <CrmMergeBody proposal={item.raw} />
              ) : kbBody !== undefined ? (
                <ReactMarkdown components={MD_COMPONENTS}>{editedBody}</ReactMarkdown>
              ) : (
                <span className="text-ink-mute italic">Loading…</span>
              )}
            </div>
          )}
        </section>
      </div>

      {editing ? (
        <DrawerFooter
          primary={{
            label: 'Save ↵',
            onClick: () => void saveEdit(),
            disabled: pending || !editedBody.trim(),
          }}
          secondary={[{ label: 'Cancel', onClick: cancelEdit }]}
          shortcut="⌘↵ save · esc cancel"
        />
      ) : (
        <DrawerFooter
          primary={{ label: 'Approve', onClick: onApprove, disabled: pending }}
          secondary={[
            { label: 'Edit', onClick: () => setEditing(true), disabled: !editable },
            { label: 'Dismiss', onClick: onDismiss, disabled: pending },
          ]}
          shortcut="⌘↵ approve"
        />
      )}
    </>
  );
}

function CrmMergeBody({ proposal }: { proposal: CrmMergeProposalDto }) {
  const keeper =
    proposal.recommendedKeeperId === proposal.contactA.id ? proposal.contactA : proposal.contactB;
  const loser =
    proposal.recommendedKeeperId === proposal.contactA.id ? proposal.contactB : proposal.contactA;
  const fmt = (c: CrmContactSummary) =>
    [c.name, c.email].filter(Boolean).join(' · ') || c.id;
  return (
    <>
      <p>
        Merge <strong>{fmt(loser)}</strong> into <strong>{fmt(keeper)}</strong>.
      </p>
      <p className="mt-2 text-ink-mute">
        Keeps the primary; rewrites foreign keys; archives the loser. No conversations are lost.
      </p>
    </>
  );
}

function DrawerHeader({
  pillTone,
  pillLabel,
  title,
  meta,
  rightExtra,
  onClose,
}: {
  pillTone: 'live' | 'ink' | 'draft' | 'kb' | 'crm' | 'out' | 'review';
  pillLabel: string;
  title: string;
  meta?: string;
  rightExtra?: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="border-b border-rule-soft px-6 pb-4 pt-5 dark:border-rule-on-dark">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-2">
          <div className="flex items-center gap-2">
            <Pill tone={pillTone}>{pillLabel}</Pill>
            {rightExtra}
          </div>
          <h2 className="font-serif text-2xl leading-tight font-normal tracking-tight text-ink dark:text-foreground">
            {title}
          </h2>
          {meta && (
            <p className="font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute">{meta}</p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute hover:text-ink dark:hover:text-foreground"
          aria-label="Close"
        >
          close ×
        </button>
      </div>
    </div>
  );
}

function DrawerFooter({
  primary,
  secondary,
  shortcut,
}: {
  primary: { label: string; onClick: () => void; disabled?: boolean };
  secondary: Array<{ label: string; onClick: () => void; disabled?: boolean }>;
  shortcut?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2 border-t border-rule-soft px-6 py-3 dark:border-rule-on-dark">
      <div className="flex items-center gap-2">
        <Button variant="accent" size="sm" onClick={primary.onClick} disabled={primary.disabled}>
          {primary.label}
        </Button>
        {secondary.map((b, i) => (
          <Button
            key={i}
            variant={i === 0 ? 'default' : 'outline'}
            size="sm"
            onClick={b.onClick}
            disabled={b.disabled}
          >
            {b.label}
          </Button>
        ))}
      </div>
      {shortcut && (
        <span className="font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute">
          {shortcut}
        </span>
      )}
    </div>
  );
}

function MessageBubble({ message }: { message: MessageDto }) {
  const isStaff = message.authorType === 'user';
  const isAgent = message.authorType === 'agent';
  const isOutbound = isStaff || isAgent;
  const isSystem = message.authorType === 'system';

  if (isSystem) {
    return (
      <div className="self-center text-center font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute">
        — {message.body} —
      </div>
    );
  }
  if (message.internal) {
    return (
      <div
        className={cn(
          'max-w-[85%] border border-amber-200 bg-amber-50 px-3 py-2 text-sm dark:border-amber-500/30 dark:bg-amber-500/10',
          isOutbound ? 'ml-auto rounded-bubble rounded-tr-[2px]' : 'mr-auto rounded-bubble rounded-tl-[2px]',
        )}
      >
        <div className="mb-0.5 flex items-center gap-1 font-mono text-[9px] uppercase tracking-eyebrow text-amber-700 dark:text-amber-200">
          <AlertCircle className="size-3" /> internal · {message.authorType}
        </div>
        <div className="whitespace-pre-wrap">{message.body}</div>
      </div>
    );
  }
  return (
    <div
      className={cn(
        'max-w-[85%] px-3 py-2 text-sm',
        isStaff
          ? 'ml-auto rounded-bubble rounded-tr-[2px] bg-cobalt text-paper'
          : isAgent
          ? 'ml-auto rounded-bubble rounded-tr-[2px] bg-ink text-paper dark:bg-paper dark:text-ink'
          : 'mr-auto rounded-bubble rounded-tl-[2px] bg-paper-deep text-ink dark:bg-secondary dark:text-foreground',
      )}
    >
      <div
        className={cn(
          'mb-0.5 font-mono text-[9px] uppercase tracking-eyebrow',
          isStaff
            ? 'text-paper/70'
            : isAgent
            ? 'text-paper/70 dark:text-ink/70'
            : 'text-ink-mute',
        )}
      >
        {message.authorType}
      </div>
      <div className="whitespace-pre-wrap">{message.body}</div>
    </div>
  );
}

function ActivityRail({
  contactId,
  conversationId,
}: {
  contactId: string | null;
  conversationId: string;
}) {
  const [events, setEvents] = useState<ActivityDto[]>([]);
  const [open, setOpen] = useState(false);
  const last = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    const param = contactId ? `contactId=${contactId}` : `conversationId=${conversationId}`;
    try {
      const page = await api<{ items: ActivityDto[] }>(`/api/activity?${param}&limit=20`);
      setEvents(page.items);
      last.current = page.items[0]?.id ?? null;
    } catch {
      return;
    }
  }, [contactId, conversationId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const railSubs = useMemo<SubscriptionChannel[]>(
    () =>
      contactId
        ? [{ channel: 'contact', id: contactId }]
        : [{ channel: 'conversation', id: conversationId }],
    [contactId, conversationId],
  );
  useRealtime(railSubs, () => {
    void refresh();
  });

  return (
    <div className="border-t border-rule-soft dark:border-rule-on-dark">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-6 py-3 font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute hover:text-ink dark:hover:text-foreground"
      >
        <span>{contactId ? 'Contact activity' : 'Conversation activity'}</span>
        <span>{open ? '−' : '+'}</span>
      </button>
      {open && (
        <ul className="max-h-48 space-y-1 overflow-y-auto px-6 pb-3 text-xs">
          {events.map((e) => (
            <li key={e.id} className="flex items-start gap-2">
              <span className="font-mono text-[10px] text-ink-mute">{relative(e.createdAt)}</span>
              <span>{e.type}</span>
            </li>
          ))}
          {events.length === 0 && (
            <li className="text-ink-mute font-serif italic">No activity yet.</li>
          )}
        </ul>
      )}
    </div>
  );
}

function useCmdEnter(handler: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        handler();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handler]);
}

function relative(iso: string): string {
  const d = new Date(iso).getTime();
  const diff = Date.now() - d;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return `${Math.floor(diff / 86_400_000)}d`;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function messageOf(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return err instanceof Error ? err.message : 'Unknown error';
}
