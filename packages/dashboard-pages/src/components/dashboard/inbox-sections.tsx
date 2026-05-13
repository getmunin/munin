'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, MessageSquare, Unplug, User } from 'lucide-react';
import ReactMarkdown, { type Components } from 'react-markdown';
import { useTranslations } from 'next-intl';
import {
  Button,
  Pill,
  Sheet,
  SheetContent,
  cn,
} from '@getmunin/ui';
import { api, ApiError } from '../../api';
import { notify } from '../../lib/notify';
import { useRealtime, type SubscriptionChannel } from '../../realtime';

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
  authorName: string | null;
  body: string;
  internal: boolean;
  inReplyToId: string | null;
  attachments: unknown[];
  metadata: Record<string, unknown>;
  createdAt: string;
  seenAt?: string | null;
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

export type QueueItem =
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

function useQueueBuilder() {
  const tQueue = useTranslations('dashboard.overview.queue');

  return useCallback(
    (q: InboxQueueResponse['queue']): QueueItem[] => {
      const kb = q.kb.map<QueueItem>((k) => ({
        kind: 'kb',
        id: k.id,
        title: k.title,
        snippet: k.proposedTargetSpaceSlug
          ? tQueue('kbSnippetProposed', { slug: k.proposedTargetSpaceSlug })
          : tQueue('kbSnippetFallback'),
        createdAt: k.updatedAt,
        raw: k,
      }));
      const crm = q.crm.map<QueueItem>((c) => ({
        kind: 'crm',
        id: c.id,
        title: `${contactLabel(c.contactA)} ↔ ${contactLabel(c.contactB)}`,
        snippet: tQueue('crmSnippet', { confidence: c.confidence }),
        createdAt: c.createdAt,
        raw: c,
      }));
      const outreach = q.outreach.map<QueueItem>((o) => ({
        kind: 'outreach',
        id: o.id,
        title: o.draftSubject ?? o.campaign?.name ?? tQueue('outreachDraftFallback'),
        snippet: o.contact?.email
          ? `${o.contact.email} — ${o.draftBody.slice(0, 80)}`
          : o.draftBody.slice(0, 100),
        createdAt: o.createdAt,
        raw: o,
      }));
      return [...kb, ...crm, ...outreach].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
    },
    [tQueue],
  );
}

const contactLabel = (c: CrmContactSummary) => c.name ?? c.email ?? c.id;

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
            authorName: null,
            body: latest.body,
            internal: false,
            inReplyToId: null,
            attachments: [],
            metadata: {},
            createdAt: latest.createdAt,
          },
        ]
      : [],
  };
}

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

export interface InboxController {
  items: LiveSummary[];
  details: Record<string, ConversationDetail>;
  queue: QueueItem[];
  pending: boolean;
  loadError: ApiError | null;
  hasLoadedOnce: boolean;
  retrying: boolean;
  retryLoad: () => Promise<void>;
  convDrawer: ConvDrawer;
  setConvDrawer: (next: ConvDrawer) => void;
  queueDrawer: QueueItem | null;
  setQueueDrawer: (next: QueueItem | null) => void;
  reply: string;
  setReply: (next: string) => void;
  draftEdit: string | null;
  setDraftEdit: (next: string | null) => void;
  kbBodies: Record<string, string>;
  takeOver: (id: string, openFullAfter?: boolean) => Promise<void>;
  release: (id: string) => Promise<void>;
  closeConv: (id: string) => Promise<void>;
  send: (id: string, body: string, options?: { claim?: boolean; closeDrawer?: boolean }) => Promise<void>;
  approveQueue: (item: QueueItem) => Promise<void>;
  saveQueue: (item: QueueItem, body: string) => Promise<void>;
  dismissQueue: (item: QueueItem) => Promise<void>;
}

export function useInboxData(): InboxController {
  const buildQueue = useQueueBuilder();
  const [items, setItems] = useState<LiveSummary[]>([]);
  const [details, setDetails] = useState<Record<string, ConversationDetail>>({});
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [kbBodies, setKbBodies] = useState<Record<string, string>>({});
  const [convDrawer, setConvDrawer] = useState<ConvDrawer>(null);
  const [queueDrawer, setQueueDrawer] = useState<QueueItem | null>(null);
  const [reply, setReply] = useState('');
  const [draftEdit, setDraftEdit] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [retrying, setRetrying] = useState(false);

  const loadInbox = useCallback(async () => {
    try {
      const res = await api<InboxQueueResponse>('/api/v1/inbox');
      setItems(res.live);
      setDetails((prev) => mergeLive(prev, res.live));
      setQueue(buildQueue(res.queue));
      setLoadError(null);
      setHasLoadedOnce(true);
    } catch (err) {
      if (err instanceof ApiError) setLoadError(err);
      notify.error(messageOf(err));
    }
  }, [buildQueue]);

  const retryLoad = useCallback(async () => {
    setRetrying(true);
    try {
      await loadInbox();
    } finally {
      setRetrying(false);
    }
  }, [loadInbox]);

  useEffect(() => {
    if (!loadError) return;
    const id = setInterval(() => {
      void retryLoad();
    }, 30_000);
    return () => clearInterval(id);
  }, [loadError, retryLoad]);

  const loadDetail = useCallback(async (id: string) => {
    try {
      const d = await api<ConversationDetail>(`/api/v1/conversations/${id}`);
      setDetails((prev) => ({ ...prev, [id]: d }));
    } catch (err) {
      notify.error(messageOf(err));
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
      `/api/v1/kb/curation/candidates/${queueDrawer.id}`,
    )
      .then((doc) => setKbBodies((prev) => ({ ...prev, [queueDrawer.id]: doc.body })))
      .catch(() => {});
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

  const takeOver = useCallback(
    async (id: string, openFullAfter = true) => {
      setPending(true);
      try {
        await api(`/api/v1/conversations/${id}/take-over`, { method: 'POST', body: '{}' });
        await Promise.all([loadDetail(id), loadInbox()]);
        if (openFullAfter) setConvDrawer({ id, mode: 'full' });
      } catch (err) {
        notify.error(messageOf(err));
      } finally {
        setPending(false);
      }
    },
    [loadDetail, loadInbox],
  );

  const release = useCallback(
    async (id: string) => {
      setPending(true);
      try {
        await api(`/api/v1/conversations/${id}/release`, { method: 'POST', body: '{}' });
        await Promise.all([loadDetail(id), loadInbox()]);
      } catch (err) {
        notify.error(messageOf(err));
      } finally {
        setPending(false);
      }
    },
    [loadDetail, loadInbox],
  );

  const closeConv = useCallback(
    async (id: string) => {
      setPending(true);
      try {
        await api(`/api/v1/conversations/${id}/status`, {
          method: 'POST',
          body: JSON.stringify({ status: 'closed' }),
        });
        setConvDrawer(null);
        setItems((prev) => prev.filter((it) => it.id !== id));
        await loadInbox();
      } catch (err) {
        notify.error(messageOf(err));
      } finally {
        setPending(false);
      }
    },
    [loadInbox],
  );

  const send = useCallback(
    async (id: string, body: string, options: { claim?: boolean; closeDrawer?: boolean } = {}) => {
      if (!body.trim()) return;
      const trimmed = body.trim();
      const temp: MessageDto = {
        id: `pending-${Date.now()}`,
        conversationId: id,
        authorType: 'user',
        authorId: 'me',
        authorName: null,
        body: trimmed,
        internal: false,
        inReplyToId: null,
        attachments: [],
        metadata: {},
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
        const payload: Record<string, unknown> = { body: trimmed };
        if (options.claim === false) payload.claim = false;
        await api(`/api/v1/conversations/${id}/messages`, {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        if (options.closeDrawer) {
          setConvDrawer(null);
          setItems((prev) => prev.filter((it) => it.id !== id));
        }
        await loadInbox();
        if (!options.closeDrawer) {
          await loadDetail(id);
        }
      } catch (err) {
        notify.error(messageOf(err));
        setDetails((prev) => {
          const d = prev[id];
          if (!d) return prev;
          return { ...prev, [id]: { ...d, messages: d.messages.filter((m) => m.id !== temp.id) } };
        });
        setReply(trimmed);
      } finally {
        setPending(false);
      }
    },
    [loadDetail, loadInbox],
  );

  const approveQueue = useCallback(
    async (item: QueueItem) => {
      setPending(true);
      try {
        if (item.kind === 'kb') {
          const targetSlug = item.raw.proposedTargetSpaceSlug ?? 'support-faq';
          await api(`/api/v1/kb/curation/candidates/${item.id}/publish`, {
            method: 'POST',
            body: JSON.stringify({ targetSpaceSlug: targetSlug }),
          });
        } else if (item.kind === 'crm') {
          await api(`/api/v1/crm/merge-proposals/${item.id}/apply`, { method: 'POST' });
        } else {
          await api(`/api/v1/outreach/proposals/${item.id}/approve`, { method: 'POST' });
        }
        await loadInbox();
        setQueueDrawer(null);
      } catch (err) {
        notify.error(messageOf(err));
      } finally {
        setPending(false);
      }
    },
    [loadInbox],
  );

  const saveQueue = useCallback(
    async (item: QueueItem, body: string) => {
      setPending(true);
      try {
        if (item.kind === 'kb') {
          await api(`/api/v1/kb/curation/candidates/${item.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ body }),
          });
          setKbBodies((prev) => ({ ...prev, [item.id]: body }));
        } else if (item.kind === 'outreach') {
          await api(`/api/v1/outreach/proposals/${item.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ draftBody: body }),
          });
        }
        await loadInbox();
      } catch (err) {
        notify.error(messageOf(err));
        throw err;
      } finally {
        setPending(false);
      }
    },
    [loadInbox],
  );

  const dismissQueue = useCallback(
    async (item: QueueItem) => {
      setPending(true);
      try {
        if (item.kind === 'kb') {
          await api(`/api/v1/kb/curation/candidates/${item.id}/dismiss`, { method: 'POST' });
        } else if (item.kind === 'crm') {
          await api(`/api/v1/crm/merge-proposals/${item.id}/dismiss`, {
            method: 'POST',
            body: JSON.stringify({}),
          });
        } else {
          await api(`/api/v1/outreach/proposals/${item.id}/dismiss`, {
            method: 'POST',
            body: JSON.stringify({}),
          });
        }
        await loadInbox();
        setQueueDrawer(null);
      } catch (err) {
        notify.error(messageOf(err));
      } finally {
        setPending(false);
      }
    },
    [loadInbox],
  );

  return {
    items,
    details,
    queue,
    pending,
    loadError,
    hasLoadedOnce,
    retrying,
    retryLoad,
    convDrawer,
    setConvDrawer,
    queueDrawer,
    setQueueDrawer,
    reply,
    setReply,
    draftEdit,
    setDraftEdit,
    kbBodies,
    takeOver,
    release,
    closeConv,
    send,
    approveQueue,
    saveQueue,
    dismissQueue,
  };
}

export function LiveNowSection({ controller }: { controller: InboxController }) {
  const t = useTranslations('dashboard.overview.liveNow');
  const { items, details, pending, setConvDrawer, setReply, setDraftEdit, takeOver } = controller;
  if (items.length === 0) return null;

  return (
    <section className="bg-paper-deep -mx-10 px-10 py-6 dark:bg-secondary">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <span
            className="size-2 rounded-full bg-cobalt animate-pulse dark:bg-cobalt-soft"
            aria-hidden
          />
          <h2 className="font-mono text-[10px] uppercase tracking-eyebrow text-cobalt dark:text-cobalt-soft">
            {t('eyebrow')} · {items.length}
          </h2>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute">
          {t('subtitle')}
        </span>
      </div>
      <ul className="space-y-3">
        {items.map((c) => (
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
  );
}

export function QueueSection({ controller }: { controller: InboxController }) {
  const t = useTranslations('dashboard.overview.queue');
  const { queue, pending, setQueueDrawer, approveQueue, dismissQueue } = controller;
  if (queue.length === 0) return null;

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute">
          {t('eyebrow')} · {queue.length}
        </h2>
        <span className="font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute">
          {t('sortedByRecency')}
        </span>
      </div>
      <ul className="border-t-[0.5px] border-rule-soft dark:border-rule-on-dark">
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
      </ul>
    </section>
  );
}

export function InboxDrawers({ controller }: { controller: InboxController }) {
  const t = useTranslations('dashboard.overview.drawer');
  const {
    convDrawer,
    setConvDrawer,
    queueDrawer,
    setQueueDrawer,
    details,
    pending,
    reply,
    setReply,
    draftEdit,
    setDraftEdit,
    kbBodies,
    send,
    takeOver,
    release,
    closeConv,
    approveQueue,
    saveQueue,
    dismissQueue,
  } = controller;
  const selectedConv = convDrawer ? details[convDrawer.id] : null;

  return (
    <>
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
                onSendDraft={(body) => void send(selectedConv.id, body, { claim: false, closeDrawer: true })}
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
              <MessageSquare className="mr-2 size-4" /> {t('loading')}
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
    </>
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
  const t = useTranslations('dashboard.overview.liveNow');
  const tDrawer = useTranslations('dashboard.overview.drawer');
  const age = useRelative();
  const claimed = detail?.claim != null;
  const flaggedAtMs = conv.needsHumanAttentionAt
    ? Date.parse(conv.needsHumanAttentionAt)
    : null;
  const lastEndUserMsg = detail?.messages
    .slice()
    .reverse()
    .find((m) => {
      if (m.authorType !== 'end_user') return false;
      if (flaggedAtMs == null) return true;
      return Date.parse(m.createdAt) <= flaggedAtMs;
    });
  const who = conv.endUserId ?? tDrawer('conversationFallback', { id: conv.displayId });
  const subject = conv.subject ?? tDrawer('conversationFallback', { id: conv.displayId });
  const waiting = conv.needsHumanAttentionAt
    ? age(conv.needsHumanAttentionAt)
    : conv.lastMessageAt
      ? age(conv.lastMessageAt)
      : '';

  const handleCardClick = () => onOpen(claimed ? 'full' : 'simplified');

  return (
    <li>
      <div
        className="group/livecard flex items-stretch gap-4 border-[0.5px] border-ink bg-paper px-5 py-4 cursor-pointer transition-colors duration-fast ease-munin hover:border-cobalt dark:border-rule-on-dark dark:bg-card dark:hover:border-cobalt-soft"
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
              <span className="text-cobalt dark:text-cobalt-soft">{t('takenOver')}</span>
            ) : (
              <span className="text-cobalt dark:text-cobalt-soft">
                {t('waiting', { age: waiting })}
              </span>
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
              {t('chat')}
            </Button>
          ) : (
            <>
              <Button
                variant="accent"
                size="sm"
                onClick={() => onOpen('simplified')}
                disabled={pending}
              >
                {t('reply')}
              </Button>
              <Button size="sm" onClick={onTakeOver} disabled={pending}>
                {t('takeOver')}
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
  const t = useTranslations('dashboard.overview.queue');
  const age = useRelative();
  const tone: 'kb' | 'crm' | 'out' = item.kind === 'outreach' ? 'out' : item.kind;
  const labelKey =
    item.kind === 'outreach' ? 'kindOutreach' : item.kind === 'kb' ? 'kindKb' : 'kindCrm';
  return (
    <li>
      <div
        className="group/qrow relative flex items-center gap-4 border-b-[0.5px] border-rule-soft px-4 py-3 transition-colors duration-fast ease-munin hover:bg-paper-deep cursor-pointer dark:border-rule-on-dark dark:hover:bg-secondary"
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
          <Pill tone={tone}>{t(labelKey)}</Pill>
        </span>
        <div className="min-w-0 flex-1">
          <span className="text-sm font-medium text-ink dark:text-foreground">{item.title}</span>
          <span className="ml-2 text-sm text-ink-mute"> — {item.snippet}</span>
        </div>
        <span className="shrink-0 font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute opacity-100 transition-opacity duration-fast ease-munin group-hover/qrow:opacity-0">
          {age(item.createdAt)}
        </span>
        <div
          className="absolute inset-y-0 right-3 flex items-center gap-2 opacity-0 transition-opacity duration-fast ease-munin group-hover/qrow:opacity-100 focus-within:opacity-100"
          onClick={(e) => e.stopPropagation()}
        >
          <Button variant="accent" size="sm" onClick={onApprove} disabled={pending}>
            {t('approve')}
          </Button>
          <Button variant="outline" size="sm" onClick={onDismiss} disabled={pending}>
            {t('dismiss')}
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
  const t = useTranslations('dashboard.overview.drawer');
  const age = useRelative();
  const customer = detail.messages
    .slice()
    .reverse()
    .find((m) => m.authorType === 'end_user' && !m.internal);
  const draft = detail.messages
    .slice()
    .reverse()
    .find(
      (m) =>
        m.authorType === 'agent' &&
        m.internal &&
        m.metadata?.['kind'] === 'draft_reply',
    );

  const draftBody = draftEdit ?? draft?.body ?? '';
  const isEditing = draftEdit !== null || !draft;
  const waiting = detail.needsHumanAttentionAt ? age(detail.needsHumanAttentionAt) : '';
  const who = detail.endUserId ?? t('conversationFallback', { id: detail.displayId });

  useCmdEnter(() => {
    if (draftBody.trim() && !pending) onSendDraft(draftBody);
  });

  return (
    <>
      <DrawerHeader
        pillTone="live"
        pillLabel={t('pillConversation')}
        title={detail.subject ?? t('conversationFallback', { id: detail.displayId })}
        meta={t('metaConv', { who, age: waiting })}
        onClose={onClose}
        closeLabel={t('close')}
      />

      <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
        {customer && (
          <section className="space-y-2">
            <p className="font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute">
              {t('customer')}
            </p>
            <p className="border-l-2 border-cobalt pl-3 font-serif italic text-cobalt dark:border-cobalt-soft dark:text-cobalt-soft">
              &ldquo;{customer.body}&rdquo;
            </p>
          </section>
        )}

        <section className="space-y-2">
          <p className="font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute">
            {t('agentDraft')}
          </p>
          {isEditing ? (
            <textarea
              value={draftBody}
              onChange={(e) => setDraftEdit(e.target.value)}
              rows={8}
              className="w-full rounded-input border-[0.5px] border-ink bg-paper px-4 py-3 text-sm leading-relaxed outline-none focus-visible:border-cobalt focus-visible:ring-1 focus-visible:ring-cobalt dark:bg-card dark:border-rule-on-dark dark:text-foreground"
              autoFocus
            />
          ) : (
            <div className="border-[0.5px] border-ink bg-paper px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap dark:bg-card dark:border-rule-on-dark dark:text-foreground">
              {draft?.body}
            </div>
          )}
        </section>
      </div>

      <DrawerFooter
        primary={{
          label: t('sendDraft'),
          onClick: () => onSendDraft(draftBody),
          disabled: pending || !draftBody.trim(),
        }}
        secondary={[
          draft
            ? isEditing
              ? { label: t('cancel'), onClick: () => setDraftEdit(null) }
              : {
                  label: t('edit'),
                  onClick: () => setDraftEdit(draft.body),
                }
            : null,
          { label: t('takeOver'), onClick: onTakeOver, disabled: pending },
        ].filter((a): a is { label: string; onClick: () => void } => a !== null)}
        shortcut={t('shortcutSend')}
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
  const t = useTranslations('dashboard.overview.drawer');
  const claimed = detail.claim !== null;
  const endUserLabel = detail.endUserId ?? t('endUserFallback');

  const messagesRef = useRef<HTMLDivElement | null>(null);
  const lastMessageId = detail.messages[detail.messages.length - 1]?.id;
  useEffect(() => {
    const el = messagesRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [detail.id, lastMessageId, detail.messages.length]);

  useCmdEnter(() => {
    if (reply.trim() && !pending) onSend();
  });

  return (
    <>
      <DrawerHeader
        pillTone={detail.needsHumanAttention ? 'live' : detail.status === 'open' ? 'ink' : 'draft'}
        pillLabel={detail.needsHumanAttention ? t('pillLive') : detail.status}
        title={detail.subject ?? t('conversationFallback', { id: detail.displayId })}
        meta={t('metaConvFull', { who: endUserLabel, status: detail.status })}
        rightExtra={
          claimed ? (
            <Pill tone="review" className="before:hidden">
              <User className="size-3" /> {t('pillTakenOver')}
            </Pill>
          ) : null
        }
        onClose={onClose}
        closeLabel={t('close')}
      />

      <div ref={messagesRef} className="flex-1 space-y-3 overflow-y-auto px-6 py-5">
        {detail.messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}
      </div>

      <ActivityRail contactId={detail.contactId} conversationId={detail.id} />

      <div className="border-t-[0.5px] border-rule-soft p-4 dark:border-rule-on-dark">
        <textarea
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          rows={3}
          placeholder={t('replyPlaceholder')}
          className="w-full rounded-input border-[0.5px] border-rule-soft bg-paper px-3 py-2 text-sm outline-none focus-visible:border-cobalt focus-visible:ring-1 focus-visible:ring-cobalt dark:bg-card dark:border-rule-on-dark"
        />
        <div className="mt-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {!claimed ? (
              <Button size="sm" onClick={onTakeOver} disabled={pending}>
                {t('takeOver')}
              </Button>
            ) : (
              <Button size="sm" variant="outline" onClick={onRelease} disabled={pending}>
                <Unplug className="size-3.5" /> {t('release')}
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={onCloseConv} disabled={pending}>
              {t('closeConv')}
            </Button>
          </div>
          <Button variant="accent" onClick={onSend} disabled={pending || !reply.trim()}>
            {t('send')}
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
  strong: ({ children }) => (
    <strong className="font-semibold text-ink dark:text-foreground">{children}</strong>
  ),
  em: ({ children }) => <em className="italic">{children}</em>,
  h1: ({ children }) => <p className="mb-2 font-serif text-base font-medium">{children}</p>,
  h2: ({ children }) => <p className="mb-2 font-serif text-base font-medium">{children}</p>,
  h3: ({ children }) => <p className="mb-2 font-serif text-base font-medium">{children}</p>,
  code: ({ children }) => (
    <code className="font-mono text-xs bg-paper-deep px-1 py-0.5 dark:bg-secondary">{children}</code>
  ),
  a: ({ href, children }) => (
    <a
      href={href}
      className="text-cobalt underline-offset-2 hover:underline dark:text-cobalt-soft"
    >
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
  const t = useTranslations('dashboard.overview.drawer');
  const tQueue = useTranslations('dashboard.overview.queue');
  const age = useRelative();
  const initialBody =
    item.kind === 'outreach' ? item.raw.draftBody : item.kind === 'kb' ? (kbBody ?? '') : '';
  const [editing, setEditing] = useState(false);
  const [editedBody, setEditedBody] = useState<string>(initialBody);

  useEffect(() => {
    setEditing(false);
    setEditedBody(initialBody);
  }, [item.id, initialBody]);

  const tone: 'kb' | 'crm' | 'out' = item.kind === 'outreach' ? 'out' : item.kind;
  const labelKey =
    item.kind === 'outreach' ? 'kindOutreach' : item.kind === 'kb' ? 'kindKb' : 'kindCrm';
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
    const kind =
      item.raw.kind === 'reply' ? t('outreachKindReply') : t('outreachKindInitial');
    const handle = item.raw.contact?.email ?? item.raw.campaign?.name ?? t('handleFallback');
    meta = t('metaOutreach', { kind, handle, age: age(item.createdAt) });
  } else if (item.kind === 'crm') {
    meta = t('metaCrm', { confidence: item.raw.confidence, age: age(item.createdAt) });
  } else {
    meta = t('metaKb', {
      slug: item.raw.proposedTargetSpaceSlug ?? t('kbSlugFallback'),
      age: age(item.createdAt),
    });
  }

  return (
    <>
      <DrawerHeader
        pillTone={tone}
        pillLabel={tQueue(labelKey)}
        title={item.title}
        meta={meta}
        onClose={onClose}
        closeLabel={t('close')}
      />

      <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
        {item.kind === 'outreach' && item.raw.kind === 'reply' && (
          <section className="space-y-2">
            <p className="font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute">
              {t('replyFrom')}
            </p>
            <p className="border-l-2 border-cobalt pl-3 font-serif italic text-cobalt dark:border-cobalt-soft dark:text-cobalt-soft">
              &ldquo;{item.snippet}&rdquo;
            </p>
          </section>
        )}

        <section className="space-y-2">
          <p className="font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute">
            {t('proposal')}
          </p>
          {editing ? (
            <textarea
              value={editedBody}
              onChange={(e) => setEditedBody(e.target.value)}
              rows={14}
              className="w-full resize-y rounded-input border-[0.5px] border-cobalt bg-paper px-4 py-3 text-sm leading-relaxed outline-none focus-visible:ring-1 focus-visible:ring-cobalt dark:bg-card dark:text-foreground"
              autoFocus
            />
          ) : (
            <div className="border-[0.5px] border-ink bg-paper px-4 py-3 text-sm leading-relaxed dark:bg-card dark:border-rule-on-dark dark:text-foreground">
              {item.kind === 'outreach' ? (
                <>
                  {item.raw.draftSubject && (
                    <p className="mb-2 font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute">
                      {t('subject', { subject: item.raw.draftSubject })}
                    </p>
                  )}
                  <ReactMarkdown components={MD_COMPONENTS}>{editedBody}</ReactMarkdown>
                </>
              ) : item.kind === 'crm' ? (
                <CrmMergeBody proposal={item.raw} />
              ) : kbBody !== undefined ? (
                <ReactMarkdown components={MD_COMPONENTS}>{editedBody}</ReactMarkdown>
              ) : (
                <span className="text-ink-mute italic">{t('loading')}</span>
              )}
            </div>
          )}
        </section>
      </div>

      {editing ? (
        <DrawerFooter
          primary={{
            label: t('save'),
            onClick: () => void saveEdit(),
            disabled: pending || !editedBody.trim(),
          }}
          secondary={[{ label: t('cancel'), onClick: cancelEdit }]}
          shortcut={t('shortcutSave')}
        />
      ) : (
        <DrawerFooter
          primary={{ label: t('approve'), onClick: onApprove, disabled: pending }}
          secondary={[
            { label: t('edit'), onClick: () => setEditing(true), disabled: !editable },
            { label: t('dismiss'), onClick: onDismiss, disabled: pending },
          ]}
          shortcut={t('shortcutApprove')}
        />
      )}
    </>
  );
}

function CrmMergeBody({ proposal }: { proposal: CrmMergeProposalDto }) {
  const t = useTranslations('dashboard.overview.drawer');
  const keeper =
    proposal.recommendedKeeperId === proposal.contactA.id ? proposal.contactA : proposal.contactB;
  const loser =
    proposal.recommendedKeeperId === proposal.contactA.id ? proposal.contactB : proposal.contactA;
  const fmt = (c: CrmContactSummary) => [c.name, c.email].filter(Boolean).join(' · ') || c.id;
  return (
    <>
      <p>
        {t.rich('crmMergeBody', {
          loser: fmt(loser),
          keeper: fmt(keeper),
          strong: (chunks) => <strong>{chunks}</strong>,
        })}
      </p>
      <p className="mt-2 text-ink-mute">{t('crmMergeExplain')}</p>
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
  closeLabel,
}: {
  pillTone: 'live' | 'ink' | 'draft' | 'kb' | 'crm' | 'out' | 'review';
  pillLabel: string;
  title: string;
  meta?: string;
  rightExtra?: React.ReactNode;
  onClose: () => void;
  closeLabel: string;
}) {
  return (
    <div className="border-b-[0.5px] border-rule-soft px-6 pb-4 pt-5 dark:border-rule-on-dark">
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
          aria-label={closeLabel}
        >
          {closeLabel}
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
    <div className="flex items-center justify-between gap-2 border-t-[0.5px] border-rule-soft px-6 py-3 dark:border-rule-on-dark">
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
  const t = useTranslations('dashboard.overview.drawer');
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
          'max-w-[85%] border-[0.5px] border-amber-200 bg-amber-50 px-3 py-2 text-sm dark:border-amber-500/30 dark:bg-amber-500/10',
          isOutbound
            ? 'ml-auto rounded-bubble rounded-tr-[2px]'
            : 'mr-auto rounded-bubble rounded-tl-[2px]',
        )}
      >
        <div className="mb-0.5 flex items-center gap-1 font-mono text-[9px] uppercase tracking-eyebrow text-amber-700 dark:text-amber-200">
          <AlertCircle className="size-3" /> {t('internalLabel', { author: message.authorType })}
        </div>
        <div className="whitespace-pre-wrap">{message.body}</div>
      </div>
    );
  }
  return (
    <div className={cn('flex flex-col gap-1', isOutbound ? 'items-end' : 'items-start')}>
      <div
        className={cn(
          'max-w-[85%] px-3 py-2 text-sm',
          isStaff
            ? 'rounded-bubble rounded-tr-[2px] bg-cobalt text-paper'
            : isAgent
              ? 'rounded-bubble rounded-tr-[2px] bg-ink text-paper dark:bg-paper dark:text-ink'
              : 'rounded-bubble rounded-tl-[2px] bg-paper-deep text-ink dark:bg-secondary dark:text-foreground',
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
          {bubbleLabel(message, t)}
        </div>
        <div className="whitespace-pre-wrap">{message.body}</div>
      </div>
      {isOutbound && message.seenAt && (
        <div className="font-mono text-[9px] uppercase tracking-eyebrow text-ink-mute">
          {t('seenAt', { time: formatSeenAt(message.seenAt) })}
        </div>
      )}
    </div>
  );
}

function formatSeenAt(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

function bubbleLabel(
  message: MessageDto,
  t: ReturnType<typeof useTranslations<'dashboard.overview.drawer'>>,
): string {
  if (message.authorName) return message.authorName;
  if (message.authorType === 'end_user') return t('anonymousVisitor');
  return message.authorType;
}

function ActivityRail({
  contactId,
  conversationId,
}: {
  contactId: string | null;
  conversationId: string;
}) {
  const t = useTranslations('dashboard.overview.drawer');
  const age = useRelative();
  const [events, setEvents] = useState<ActivityDto[]>([]);
  const [open, setOpen] = useState(false);
  const last = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    const param = contactId ? `contactId=${contactId}` : `conversationId=${conversationId}`;
    try {
      const page = await api<{ items: ActivityDto[] }>(`/api/v1/activity?${param}&limit=20`);
      setEvents(page.items);
      last.current = page.items[0]?.id ?? null;
    } catch (err) {
      console.warn('[inbox/activity-rail] refresh failed', err);
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
    <div className="border-t-[0.5px] border-rule-soft dark:border-rule-on-dark">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-6 py-3 font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute hover:text-ink dark:hover:text-foreground"
      >
        <span>{contactId ? t('activityContact') : t('activityConv')}</span>
        <span>{open ? '−' : '+'}</span>
      </button>
      {open && (
        <ul className="max-h-48 space-y-1 overflow-y-auto px-6 pb-3 text-xs">
          {events.map((e) => (
            <li key={e.id} className="flex items-start gap-2">
              <span className="font-mono text-[10px] text-ink-mute">{age(e.createdAt)}</span>
              <span>{e.type}</span>
            </li>
          ))}
          {events.length === 0 && (
            <li className="text-ink-mute font-serif italic">{t('activityEmpty')}</li>
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

function useRelative() {
  const t = useTranslations('dashboard.overview.relative');
  return useCallback(
    (iso: string): string => {
      const d = new Date(iso).getTime();
      const diff = Date.now() - d;
      if (diff < 60_000) return t('justNow');
      if (diff < 3_600_000) return t('minutes', { n: Math.floor(diff / 60_000) });
      if (diff < 86_400_000) return t('hours', { n: Math.floor(diff / 3_600_000) });
      return t('days', { n: Math.floor(diff / 86_400_000) });
    },
    [t],
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function messageOf(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return err instanceof Error ? err.message : 'Unknown error';
}
