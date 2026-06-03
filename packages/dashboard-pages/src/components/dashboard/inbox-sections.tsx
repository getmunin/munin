'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, MessageSquare, Unplug, User } from 'lucide-react';
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
import { useRelative } from '../../lib/use-relative';
import { useRealtime, type RealtimeStatus, type SubscriptionChannel } from '../../realtime';
import { QueueDrawer } from './queue-drawers';
import {
  queueLabelKey,
  queueTone,
  type CmsDraftDetailDto,
  type CmsDraftSummaryDto,
  type CrmContactSummary,
  type CrmMergeProposalDto,
  type FeedbackOutboxDto,
  type KbCandidateDto,
  type OutreachProposalDto,
  type QueueItem,
} from './queue-drawers/types';
import { DrawerFooter, DrawerHeader, useCmdEnter } from './queue-drawers/shared';

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

export type { QueueItem };

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
    cms: CmsDraftSummaryDto[];
    feedback?: FeedbackOutboxDto[];
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
      const cms = (q.cms ?? []).map<QueueItem>((c) => ({
        kind: 'cms',
        id: c.id,
        title: c.title ?? tQueue('cmsUntitled'),
        snippet:
          c.wordCount != null
            ? tQueue('cmsSnippet', { collection: c.collectionName, wordCount: c.wordCount })
            : tQueue('cmsSnippetNoBody', { collection: c.collectionName }),
        createdAt: c.updatedAt,
        raw: c,
      }));
      const feedback = (q.feedback ?? []).map<QueueItem>((f) => ({
        kind: 'feedback',
        id: f.id,
        title: f.title,
        snippet: feedbackSnippet(f, tQueue),
        createdAt: f.createdAt,
        raw: f,
      }));
      return [...kb, ...crm, ...outreach, ...cms, ...feedback].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
    },
    [tQueue],
  );
}

function feedbackSnippet(
  f: FeedbackOutboxDto,
  tQueue: ReturnType<typeof useTranslations<'dashboard.overview.queue'>>,
): string {
  const scope = f.appScope ? f.appScope.toUpperCase() : tQueue('feedbackScopeFallback');
  const attributed = f.includeOrgName || f.includeUserName;
  return attributed
    ? tQueue('feedbackSnippetAttributed', { scope })
    : tQueue('feedbackSnippet', { scope });
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

export type ConvActionError =
  | { type: 'send' | 'takeOver' | 'release' | 'close'; conversationId: string; message: string }
  | null;

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
  cmsDetails: Record<string, CmsDraftDetailDto>;
  detailErrors: Record<string, string>;
  reloadDetail: (id: string) => Promise<void>;
  actionError: ConvActionError;
  clearActionError: () => void;
  connectionStatus: RealtimeStatus;
  takeOver: (id: string, openFullAfter?: boolean) => Promise<void>;
  release: (id: string) => Promise<void>;
  closeConv: (id: string) => Promise<void>;
  send: (id: string, body: string, options?: { claim?: boolean; closeDrawer?: boolean }) => Promise<void>;
  approveQueue: (item: QueueItem) => Promise<void>;
  saveQueue: (item: QueueItem, body: string) => Promise<void>;
  dismissQueue: (item: QueueItem) => Promise<void>;
  scheduleQueue: (item: QueueItem, scheduledAt: string) => Promise<void>;
}

export function useInboxData(): InboxController {
  const buildQueue = useQueueBuilder();
  const [items, setItems] = useState<LiveSummary[]>([]);
  const [details, setDetails] = useState<Record<string, ConversationDetail>>({});
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [kbBodies, setKbBodies] = useState<Record<string, string>>({});
  const [cmsDetails, setCmsDetails] = useState<Record<string, CmsDraftDetailDto>>({});
  const [convDrawer, setConvDrawer] = useState<ConvDrawer>(null);
  const [queueDrawer, setQueueDrawer] = useState<QueueItem | null>(null);
  const [reply, setReply] = useState('');
  const [draftEdit, setDraftEdit] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [detailErrors, setDetailErrors] = useState<Record<string, string>>({});
  const [actionError, setActionError] = useState<ConvActionError>(null);

  const loadInbox = useCallback(async () => {
    try {
      const res = await api<InboxQueueResponse>('/v1/inbox');
      setItems(res.live);
      setDetails((prev) => mergeLive(prev, res.live));
      setQueue(buildQueue(res.queue));
      setLoadError(null);
      setHasLoadedOnce(true);
    } catch (err) {
      if (err instanceof ApiError) setLoadError(err);
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
      const d = await api<ConversationDetail>(`/v1/conversations/${id}`);
      setDetails((prev) => ({ ...prev, [id]: d }));
      setDetailErrors((prev) => {
        if (!prev[id]) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
    } catch (err) {
      setDetailErrors((prev) => ({ ...prev, [id]: messageOf(err) }));
    }
  }, []);

  const reloadDetail = useCallback(
    async (id: string) => {
      await loadDetail(id);
    },
    [loadDetail],
  );

  const clearActionError = useCallback(() => setActionError(null), []);

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
      `/v1/kb/curation/candidates/${queueDrawer.id}`,
    )
      .then((doc) => setKbBodies((prev) => ({ ...prev, [queueDrawer.id]: doc.body })))
      .catch(() => {});
  }, [queueDrawer, kbBodies]);

  useEffect(() => {
    if (!queueDrawer || queueDrawer.kind !== 'cms') return;
    if (cmsDetails[queueDrawer.id] !== undefined) return;
    void api<CmsDraftDetailDto>(`/v1/cms-drafts/${queueDrawer.id}`)
      .then((doc) => setCmsDetails((prev) => ({ ...prev, [queueDrawer.id]: doc })))
      .catch(() => {});
  }, [queueDrawer, cmsDetails]);

  const subscriptions = useMemo<SubscriptionChannel[]>(() => {
    const subs: SubscriptionChannel[] = [{ channel: 'org' }];
    if (convDrawer) subs.push({ channel: 'conversation', id: convDrawer.id });
    return subs;
  }, [convDrawer]);

  const { status: connectionStatus } = useRealtime(subscriptions, (event) => {
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

  const wasOfflineRef = useRef(false);
  useEffect(() => {
    if (connectionStatus === 'offline') {
      wasOfflineRef.current = true;
      return;
    }
    if (connectionStatus === 'connected' && wasOfflineRef.current) {
      wasOfflineRef.current = false;
      setActionError(null);
      setDetailErrors({});
      void loadInbox();
      if (convDrawer) void loadDetail(convDrawer.id);
    }
  }, [connectionStatus, convDrawer, loadDetail, loadInbox]);

  const takeOver = useCallback(
    async (id: string, openFullAfter = true) => {
      setPending(true);
      setActionError(null);
      try {
        await api(`/v1/conversations/${id}/take-over`, { method: 'POST', body: '{}' });
        await Promise.all([loadDetail(id), loadInbox()]);
        if (openFullAfter) setConvDrawer({ id, mode: 'full' });
      } catch (err) {
        setActionError({ type: 'takeOver', conversationId: id, message: messageOf(err) });
      } finally {
        setPending(false);
      }
    },
    [loadDetail, loadInbox],
  );

  const release = useCallback(
    async (id: string) => {
      setPending(true);
      setActionError(null);
      try {
        await api(`/v1/conversations/${id}/release`, { method: 'POST', body: '{}' });
        await Promise.all([loadDetail(id), loadInbox()]);
      } catch (err) {
        setActionError({ type: 'release', conversationId: id, message: messageOf(err) });
      } finally {
        setPending(false);
      }
    },
    [loadDetail, loadInbox],
  );

  const closeConv = useCallback(
    async (id: string) => {
      setPending(true);
      setActionError(null);
      try {
        await api(`/v1/conversations/${id}/status`, {
          method: 'POST',
          body: JSON.stringify({ status: 'closed' }),
        });
        setConvDrawer(null);
        setItems((prev) => prev.filter((it) => it.id !== id));
        await loadInbox();
      } catch (err) {
        setActionError({ type: 'close', conversationId: id, message: messageOf(err) });
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
      setActionError(null);
      setDetails((prev) => {
        const d = prev[id];
        if (!d) return prev;
        return { ...prev, [id]: { ...d, messages: [...d.messages, temp] } };
      });
      setPending(true);
      try {
        const payload: Record<string, unknown> = { body: trimmed };
        if (options.claim === false) payload.claim = false;
        await api(`/v1/conversations/${id}/messages`, {
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
        setActionError({ type: 'send', conversationId: id, message: messageOf(err) });
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
          await api(`/v1/kb/curation/candidates/${item.id}/publish`, {
            method: 'POST',
            body: JSON.stringify({ targetSpaceSlug: targetSlug }),
          });
        } else if (item.kind === 'crm') {
          await api(`/v1/crm/merge-proposals/${item.id}/apply`, { method: 'POST' });
        } else if (item.kind === 'feedback') {
          await api(`/v1/feedback/${item.id}/approve`, { method: 'POST' });
        } else if (item.kind === 'cms') {
          await api(`/v1/cms-drafts/${item.id}/approve`, { method: 'POST', body: '{}' });
        } else {
          await api(`/v1/outreach/proposals/${item.id}/approve`, { method: 'POST' });
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
          await api(`/v1/kb/curation/candidates/${item.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ body }),
          });
          setKbBodies((prev) => ({ ...prev, [item.id]: body }));
        } else if (item.kind === 'outreach') {
          await api(`/v1/outreach/proposals/${item.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ draftBody: body }),
          });
        } else if (item.kind === 'cms') {
          const updated = await api<CmsDraftDetailDto>(`/v1/cms-drafts/${item.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ data: { body } }),
          });
          setCmsDetails((prev) => ({ ...prev, [item.id]: updated }));
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
          await api(`/v1/kb/curation/candidates/${item.id}/dismiss`, { method: 'POST' });
        } else if (item.kind === 'crm') {
          await api(`/v1/crm/merge-proposals/${item.id}/dismiss`, {
            method: 'POST',
            body: JSON.stringify({}),
          });
        } else if (item.kind === 'feedback') {
          await api(`/v1/feedback/${item.id}/reject`, { method: 'POST' });
        } else if (item.kind === 'cms') {
          await api(`/v1/cms-drafts/${item.id}/dismiss`, { method: 'POST', body: '{}' });
        } else {
          await api(`/v1/outreach/proposals/${item.id}/dismiss`, {
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

  const scheduleQueue = useCallback(
    async (item: QueueItem, scheduledAt: string) => {
      if (item.kind !== 'cms') return;
      setPending(true);
      try {
        await api(`/v1/cms-drafts/${item.id}/schedule`, {
          method: 'POST',
          body: JSON.stringify({ scheduledAt }),
        });
        await loadInbox();
        setQueueDrawer(null);
      } catch (err) {
        notify.error(messageOf(err));
        throw err;
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
    cmsDetails,
    detailErrors,
    reloadDetail,
    actionError,
    clearActionError,
    connectionStatus,
    takeOver,
    release,
    closeConv,
    send,
    approveQueue,
    saveQueue,
    dismissQueue,
    scheduleQueue,
  };
}

export function LiveNowSection({ controller }: { controller: InboxController }) {
  const t = useTranslations('dashboard.overview.liveNow');
  const {
    items,
    details,
    pending,
    actionError,
    setConvDrawer,
    setReply,
    setDraftEdit,
    takeOver,
  } = controller;
  if (items.length === 0) return null;

  return (
    <section className="bg-paper-deep dark:bg-secondary relative left-1/2 right-1/2 -translate-x-1/2 w-screen py-6">
      <div className="max-w-7xl mx-auto px-4 md:px-10">
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
              actionError={actionError?.conversationId === c.id ? actionError : null}
              onOpen={(mode) => {
                setReply('');
                setDraftEdit(null);
                setConvDrawer({ id: c.id, mode });
              }}
              onTakeOver={() => void takeOver(c.id, true)}
            />
          ))}
        </ul>
      </div>
    </section>
  );
}

export function QueueSection({ controller }: { controller: InboxController }) {
  const t = useTranslations('dashboard.overview.queue');
  const { queue, pending, setQueueDrawer, approveQueue, dismissQueue } = controller;
  if (queue.length === 0) return null;

  return (
    <section>
      <div className="flex items-baseline justify-between gap-4 border-b-[0.5px] border-rule-soft pb-2.5 dark:border-rule-on-dark">
        <h2 className="font-mono text-[10px] uppercase tracking-eyebrow text-ink dark:text-foreground">
          {t('eyebrow')} · {queue.length}
        </h2>
        <span className="font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute">
          {t('sortedByRecency')}
        </span>
      </div>
      <ul>
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
    cmsDetails,
    detailErrors,
    reloadDetail,
    actionError,
    clearActionError,
    send,
    takeOver,
    release,
    closeConv,
    approveQueue,
    saveQueue,
    dismissQueue,
    scheduleQueue,
  } = controller;
  const selectedConv = convDrawer ? details[convDrawer.id] : null;
  const convError = convDrawer ? detailErrors[convDrawer.id] : null;
  const drawerActionError =
    convDrawer && actionError?.conversationId === convDrawer.id ? actionError : null;

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
                actionError={drawerActionError}
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
                actionError={drawerActionError}
                onSend={() => void send(selectedConv.id, reply)}
                onTakeOver={() => void takeOver(selectedConv.id, false)}
                onRelease={() => void release(selectedConv.id)}
                onCloseConv={() => void closeConv(selectedConv.id)}
                onClose={() => setConvDrawer(null)}
                onClearActionError={clearActionError}
              />
            )
          ) : convDrawer && convError ? (
            <DrawerLoadFailed
              message={convError}
              retrying={pending}
              onRetry={() => void reloadDetail(convDrawer.id)}
              onClose={() => setConvDrawer(null)}
            />
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
              cmsDetail={
                queueDrawer.kind === 'cms' ? cmsDetails[queueDrawer.id] : undefined
              }
              pending={pending}
              onApprove={() => void approveQueue(queueDrawer)}
              onDismiss={() => void dismissQueue(queueDrawer)}
              onSave={(body) => saveQueue(queueDrawer, body)}
              onSchedule={(scheduledAt) => scheduleQueue(queueDrawer, scheduledAt)}
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
  actionError,
  onOpen,
  onTakeOver,
}: {
  conv: ConversationSummary;
  detail: ConversationDetail | undefined;
  pending: boolean;
  actionError: ConvActionError;
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
  const retryAction =
    actionError?.type === 'takeOver'
      ? onTakeOver
      : null;

  return (
    <li className="space-y-0">
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
          {actionError ? (
            <InlineActionError
              action={actionError.type}
              message={actionError.message}
              onRetry={retryAction}
            />
          ) : claimed ? (
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
              <Button size="sm" onClick={onTakeOver} disabled={pending} pending={pending}>
                {t('takeOver')}
              </Button>
            </>
          )}
        </div>
      </div>
    </li>
  );
}

function InlineActionError({
  action,
  message,
  onRetry,
}: {
  action: NonNullable<ConvActionError>['type'];
  message: string;
  onRetry: (() => void) | null;
}) {
  const t = useTranslations('dashboard.overview.drawer');
  const reason = isConnectionMessage(message) ? t('actionFailedReasonConnection') : message;
  return (
    <div
      className="flex items-center gap-[14px] whitespace-nowrap border-[0.5px] border-cobalt bg-[oklch(0.98_0.025_25)] px-3 py-1.5 text-[13px] font-medium text-cobalt dark:border-cobalt-soft dark:bg-cobalt-soft/10 dark:text-cobalt-soft"
      role="alert"
    >
      <span
        className="size-1.5 rounded-full bg-cobalt animate-pulse dark:bg-cobalt-soft"
        aria-hidden
      />
      <span>
        {t(`actionFailedShort.${action}`)} · {reason}
      </span>
      {onRetry && (
        <button
          type="button"
          className="cursor-pointer text-[13px] font-medium text-cobalt underline underline-offset-[3px] hover:text-cobalt-deep dark:text-cobalt-soft"
          onClick={onRetry}
        >
          {t('retry')} <span aria-hidden>↻</span>
        </button>
      )}
    </div>
  );
}

function isConnectionMessage(msg: string): boolean {
  return /reach munin|check your connection|network/i.test(msg);
}

function retryHandler(
  err: NonNullable<ConvActionError>,
  onSend: () => void,
  onTakeOver: () => void,
  onRelease: () => void,
  onCloseConv: () => void,
): (() => void) | null {
  if (err.type === 'send') return onSend;
  if (err.type === 'takeOver') return onTakeOver;
  if (err.type === 'release') return onRelease;
  if (err.type === 'close') return onCloseConv;
  return null;
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
  const tone = queueTone(item);
  const labelKey = queueLabelKey(item);
  return (
    <li className="border-b-[0.5px] border-rule-soft dark:border-rule-on-dark">
      <div
        className="group/qrow relative flex items-center gap-4 px-4 py-3 transition-colors duration-fast ease-munin hover:bg-paper-deep cursor-pointer dark:hover:bg-secondary"
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

function DrawerLoadFailed({
  message,
  retrying,
  onRetry,
  onClose,
}: {
  message: string;
  retrying: boolean;
  onRetry: () => void;
  onClose: () => void;
}) {
  const t = useTranslations('dashboard.overview.drawer');
  const tCommon = useTranslations('common');
  return (
    <div className="flex flex-1 flex-col gap-4 p-6">
      <div className="font-mono text-[10px] uppercase tracking-eyebrow text-destructive">
        {t('loadFailedEyebrow')}
      </div>
      <h2 className="font-serif text-xl leading-tight text-ink dark:text-foreground">
        {t('loadFailedTitle')}
      </h2>
      <p className="text-sm text-ink-mute">{message}</p>
      <div className="mt-2 flex items-center gap-3">
        <Button type="button" variant="accent" onClick={onRetry} disabled={retrying}>
          {retrying ? tCommon('retrying') : tCommon('retry')}
        </Button>
        <Button type="button" variant="outline" onClick={onClose}>
          {tCommon('close')}
        </Button>
      </div>
    </div>
  );
}

function SimplifiedConvDrawer({
  detail,
  pending,
  draftEdit,
  setDraftEdit,
  actionError,
  onSendDraft,
  onTakeOver,
  onClose,
}: {
  detail: ConversationDetail;
  pending: boolean;
  draftEdit: string | null;
  setDraftEdit: (v: string | null) => void;
  actionError: ConvActionError;
  onSendDraft: (body: string) => void;
  onTakeOver: () => void;
  onClose: () => void;
}) {
  const t = useTranslations('dashboard.overview.drawer');
  const age = useRelative();
  const flaggedAtMs = detail.needsHumanAttentionAt
    ? Date.parse(detail.needsHumanAttentionAt)
    : null;
  const customer = detail.messages
    .slice()
    .reverse()
    .find((m) => {
      if (m.authorType !== 'end_user' || m.internal) return false;
      if (flaggedAtMs == null) return true;
      return Date.parse(m.createdAt) <= flaggedAtMs;
    });
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
              className="w-full rounded-input border-[0.5px] border-ink bg-paper px-4 py-3 text-base md:text-sm leading-relaxed outline-none focus-visible:border-cobalt focus-visible:ring-1 focus-visible:ring-cobalt dark:bg-card dark:border-rule-on-dark dark:text-foreground"
              autoFocus
            />
          ) : (
            <div className="border-[0.5px] border-ink bg-paper px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap dark:bg-card dark:border-rule-on-dark dark:text-foreground">
              {draft?.body}
            </div>
          )}
        </section>
      </div>

      <div
        className={
          actionError
            ? 'border-t-[0.5px] border-cobalt dark:border-cobalt-soft'
            : undefined
        }
      >
        {actionError && (
          <div
            className="flex items-center gap-3 border-b-[0.5px] border-rule-soft bg-[oklch(0.98_0.025_25)] px-[26px] py-3 text-[13px] font-medium text-cobalt dark:border-rule-on-dark dark:bg-cobalt-soft/10 dark:text-cobalt-soft"
            role="alert"
          >
            <span
              className="size-1.5 rounded-full bg-cobalt animate-pulse dark:bg-cobalt-soft"
              aria-hidden
            />
            <span className="flex-1">
              {t(`actionFailedShort.${actionError.type}`)} ·{' '}
              {isConnectionMessage(actionError.message)
                ? t('actionFailedReasonConnection')
                : actionError.message}
            </span>
          </div>
        )}

        <DrawerFooter
          bordered={!actionError}
          primary={{
            label: actionError?.type === 'send' ? t('retryAction.send') : t('sendDraft'),
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
      </div>
    </>
  );
}

function FullConvDrawer({
  detail,
  reply,
  setReply,
  pending,
  actionError,
  onSend,
  onTakeOver,
  onRelease,
  onCloseConv,
  onClose,
  onClearActionError,
}: {
  detail: ConversationDetail;
  reply: string;
  setReply: (v: string) => void;
  pending: boolean;
  actionError: ConvActionError;
  onSend: () => void;
  onTakeOver: () => void;
  onRelease: () => void;
  onCloseConv: () => void;
  onClose: () => void;
  onClearActionError: () => void;
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

      <div
        className={
          actionError
            ? 'border-t-[0.5px] border-cobalt dark:border-cobalt-soft'
            : 'border-t-[0.5px] border-rule-soft dark:border-rule-on-dark'
        }
      >
        {actionError && (
          <div
            className="flex items-center gap-3 border-b-[0.5px] border-rule-soft bg-[oklch(0.98_0.025_25)] px-[26px] py-3 text-[13px] font-medium text-cobalt dark:border-rule-on-dark dark:bg-cobalt-soft/10 dark:text-cobalt-soft"
            role="alert"
          >
            <span
              className="size-1.5 rounded-full bg-cobalt animate-pulse dark:bg-cobalt-soft"
              aria-hidden
            />
            <span className="flex-1">
              {t(`actionFailedShort.${actionError.type}`)} ·{' '}
              {isConnectionMessage(actionError.message)
                ? t('actionFailedReasonConnection')
                : actionError.message}
            </span>
            {retryHandler(actionError, onSend, onTakeOver, onRelease, onCloseConv) ? (
              <button
                type="button"
                className="cursor-pointer text-[13px] font-medium text-cobalt underline underline-offset-[3px] hover:text-cobalt-deep dark:text-cobalt-soft"
                onClick={retryHandler(actionError, onSend, onTakeOver, onRelease, onCloseConv)!}
                disabled={pending}
              >
                {t(`retryAction.${actionError.type}`)} <span aria-hidden>↵</span>
              </button>
            ) : null}
          </div>
        )}
        <div className="p-4">
          <textarea
            value={reply}
            onChange={(e) => {
              setReply(e.target.value);
              if (actionError) onClearActionError();
            }}
            rows={3}
            placeholder={t('replyPlaceholder')}
            className="w-full rounded-input border-[0.5px] border-rule-soft bg-paper px-3 py-2 text-base md:text-sm outline-none focus-visible:border-cobalt focus-visible:ring-1 focus-visible:ring-cobalt dark:bg-card dark:border-rule-on-dark"
          />
          <div className="mt-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              {!claimed ? (
                <Button size="sm" onClick={onTakeOver} disabled={pending} pending={pending}>
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
            <Button
              variant="accent"
              onClick={onSend}
              disabled={pending || !reply.trim()}
              pending={pending}
            >
              {actionError?.type === 'send' ? t('retryAction.send') : t('send')}
            </Button>
          </div>
        </div>
      </div>
    </>
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
      const page = await api<{ items: ActivityDto[] }>(`/v1/activity?${param}&limit=20`);
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


function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function messageOf(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return err instanceof Error ? err.message : 'Unknown error';
}
