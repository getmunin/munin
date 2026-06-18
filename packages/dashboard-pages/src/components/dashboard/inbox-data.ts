'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { api, ApiError } from '../../api';
import { notify } from '../../lib/notify';
import { useRealtime, type SubscriptionChannel } from '../../realtime';
import type { CmsAssetExpanded, CmsDraftDetailDto, KbCandidateDto, QueueItem } from './queue-drawers/types';
import {
  clearKey,
  contactLabel,
  feedbackSnippet,
  mergeLive,
  messageOf,
  readFileAsBase64,
} from './inbox-helpers';
import type {
  ConvActionError,
  ConvDrawer,
  ConversationDetail,
  InboxController,
  InboxQueueResponse,
  LiveSummary,
  MessageDto,
} from './inbox-types';

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
  const [queueDetailErrors, setQueueDetailErrors] = useState<Record<string, string>>({});
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

  const loadKbBody = useCallback(async (id: string) => {
    try {
      const doc = await api<KbCandidateDto & { body: string }>(
        `/v1/kb/curation/candidates/${id}`,
      );
      setKbBodies((prev) => ({ ...prev, [id]: doc.body }));
      setQueueDetailErrors((prev) => clearKey(prev, id));
    } catch (err) {
      setQueueDetailErrors((prev) => ({ ...prev, [id]: messageOf(err) }));
    }
  }, []);

  const loadCmsDetail = useCallback(async (id: string) => {
    try {
      const doc = await api<CmsDraftDetailDto>(`/v1/cms/drafts/${id}`);
      setCmsDetails((prev) => ({ ...prev, [id]: doc }));
      setQueueDetailErrors((prev) => clearKey(prev, id));
    } catch (err) {
      setQueueDetailErrors((prev) => ({ ...prev, [id]: messageOf(err) }));
    }
  }, []);

  const reloadQueueDetail = useCallback((id: string) => {
    setQueueDetailErrors((prev) => clearKey(prev, id));
  }, []);

  useEffect(() => {
    if (!queueDrawer || queueDrawer.kind !== 'kb') return;
    if (kbBodies[queueDrawer.id] !== undefined) return;
    if (queueDetailErrors[queueDrawer.id]) return;
    void loadKbBody(queueDrawer.id);
  }, [queueDrawer, kbBodies, queueDetailErrors, loadKbBody]);

  useEffect(() => {
    if (!queueDrawer || queueDrawer.kind !== 'cms') return;
    if (cmsDetails[queueDrawer.id] !== undefined) return;
    if (queueDetailErrors[queueDrawer.id]) return;
    void loadCmsDetail(queueDrawer.id);
  }, [queueDrawer, cmsDetails, queueDetailErrors, loadCmsDetail]);

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
          await api(`/v1/cms/drafts/${item.id}/approve`, { method: 'POST', body: '{}' });
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

  const saveCmsDraft = useCallback(
    async (item: QueueItem, data: Record<string, unknown>) => {
      if (item.kind !== 'cms') {
        throw new Error(`saveCmsDraft called for non-cms item: ${item.kind}`);
      }
      setPending(true);
      try {
        const updated = await api<CmsDraftDetailDto>(`/v1/cms/drafts/${item.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ data }),
        });
        setCmsDetails((prev) => ({ ...prev, [item.id]: updated }));
        await loadInbox();
      } catch (err) {
        if (!(err instanceof ApiError && err.fieldErrors.length > 0)) {
          notify.error(messageOf(err));
        }
        throw err;
      } finally {
        setPending(false);
      }
    },
    [loadInbox],
  );

  const uploadCmsAsset = useCallback(
    async (item: QueueItem, file: File): Promise<CmsAssetExpanded> => {
      if (item.kind !== 'cms') {
        throw new Error(`uploadCmsAsset called for non-cms item: ${item.kind}`);
      }
      setPending(true);
      try {
        const base64Body = await readFileAsBase64(file);
        const asset = await api<{ id: string; publicUrl: string; altText: string | null }>(
          `/v1/cms/drafts/${item.id}/assets`,
          {
            method: 'POST',
            body: JSON.stringify({
              name: file.name,
              mime: file.type || 'application/octet-stream',
              base64Body,
            }),
          },
        );
        return { id: asset.id, publicUrl: asset.publicUrl, altText: asset.altText };
      } catch (err) {
        notify.error(messageOf(err));
        throw err;
      } finally {
        setPending(false);
      }
    },
    [],
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
          await api(`/v1/feedback/${item.id}/dismiss`, { method: 'POST' });
        } else if (item.kind === 'cms') {
          await api(`/v1/cms/drafts/${item.id}/dismiss`, { method: 'POST', body: '{}' });
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
        await api(`/v1/cms/drafts/${item.id}/schedule`, {
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
    queueDetailErrors,
    reloadDetail,
    reloadQueueDetail,
    actionError,
    clearActionError,
    connectionStatus,
    takeOver,
    release,
    closeConv,
    send,
    approveQueue,
    saveQueue,
    saveCmsDraft,
    uploadCmsAsset,
    dismissQueue,
    scheduleQueue,
  };
}
