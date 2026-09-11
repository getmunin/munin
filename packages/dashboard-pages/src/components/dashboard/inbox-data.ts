'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { api, ApiError } from '../../api';
import { notify } from '../../lib/notify';
import {
  prepareImageForUpload,
  uploadToPresigned,
  type PresignedUploadTarget,
} from '../../lib/upload-image';
import { getErrorCode, useTranslateError } from '../../i18n/translate-error';
import { useRealtime, type SubscriptionChannel } from '../../realtime';
import type {
  CmsAssetExpanded,
  CmsDraftDetailDto,
  CmsPreviewLink,
  OutreachProposalDetailDto,
  QueueItem,
  ScheduledItem,
} from './queue-panes/types';
import { clearKey, contactLabel, feedbackSnippet } from './inbox-helpers';
import type {
  QueueActionError,
  InboxController,
  InboxQueueResponse,
  LiveSummary,
} from './inbox-types';

export const DEFAULT_CURATION_TARGET_SPACE = 'support-faq';

function useQueueBuilder() {
  const tQueue = useTranslations('dashboard.overview.queue');

  return useCallback(
    (q: InboxQueueResponse['queue']): QueueItem[] => {
      const kb = q.kb.map<QueueItem>((k) => ({
        kind: 'kb',
        id: k.id,
        title: k.title,
        snippet: k.revisesDocumentId
          ? tQueue('kbSnippetRevision', {
              title: k.revisesDocumentTitle ?? k.title,
            })
          : tQueue('kbSnippetProposed', {
              space: k.proposedTargetSpaceSlug ?? DEFAULT_CURATION_TARGET_SPACE,
            }),
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
        snippet:
          o.delivery?.destination ??
          o.contact?.email ??
          o.campaign?.name ??
          tQueue('outreachDraftFallback'),
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

function useScheduledBuilder() {
  const tSched = useTranslations('dashboard.overview.scheduled');

  return useCallback(
    (q: InboxQueueResponse['queue']): ScheduledItem[] => {
      const outreach = (q.outreachScheduled ?? []).flatMap<ScheduledItem>((o) =>
        o.scheduledSendAt
          ? [
              {
                kind: 'outreach',
                id: o.id,
                title: o.draftSubject ?? o.campaign?.name ?? tSched('outreachUntitled'),
                snippet:
                  o.delivery?.destination ?? o.contact?.email ?? tSched('unknownDestination'),
                at: o.scheduledSendAt,
                raw: o,
              },
            ]
          : [],
      );
      const cms = (q.cmsScheduled ?? []).map<ScheduledItem>((c) => ({
        kind: 'cms',
        id: c.id,
        title: c.title ?? tSched('cmsUntitled'),
        snippet: tSched('cmsDestination', { collection: c.collectionName }),
        at: c.scheduledAt,
        raw: c,
      }));
      return [...outreach, ...cms].sort(
        (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime(),
      );
    },
    [tSched],
  );
}

export function useInboxData(): InboxController {
  const buildQueue = useQueueBuilder();
  const buildScheduled = useScheduledBuilder();
  const translateErr = useTranslateError();
  const [items, setItems] = useState<LiveSummary[]>([]);
  const [itemsTotal, setItemsTotal] = useState(0);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [scheduled, setScheduled] = useState<ScheduledItem[]>([]);
  const [cmsDetails, setCmsDetails] = useState<Record<string, CmsDraftDetailDto>>({});
  const [outreachDetails, setOutreachDetails] = useState<
    Record<string, OutreachProposalDetailDto>
  >({});
  const [cmsPreviewLinks, setCmsPreviewLinks] = useState<Record<string, CmsPreviewLink>>({});
  const [activeQueueItem, setActiveQueueItem] = useState<QueueItem | null>(null);
  const [activeScheduledItem, setActiveScheduledItem] = useState<ScheduledItem | null>(null);
  const [cancelTarget, setCancelTarget] = useState<ScheduledItem | null>(null);
  const [pending, setPending] = useState(false);
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [queueDetailErrors, setQueueDetailErrors] = useState<Record<string, string>>({});
  const [queueActionError, setQueueActionError] = useState<QueueActionError>(null);
  const viewedProposals = useRef<Set<string>>(new Set());

  const loadInbox = useCallback(async () => {
    try {
      const res = await api<InboxQueueResponse>('/v1/inbox');
      setItems(res.live);
      setItemsTotal(res.liveTotal);
      setQueue(buildQueue(res.queue));
      setScheduled(buildScheduled(res.queue));
      setLoadError(null);
      setHasLoadedOnce(true);
    } catch (err) {
      if (err instanceof ApiError) setLoadError(err);
    }
  }, [buildQueue, buildScheduled]);

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

  const clearQueueActionError = useCallback(() => setQueueActionError(null), []);

  useEffect(() => {
    void loadInbox();
  }, [loadInbox]);

  const loadCmsDetail = useCallback(async (id: string) => {
    try {
      const doc = await api<CmsDraftDetailDto>(`/v1/cms/drafts/${id}`);
      setCmsDetails((prev) => ({ ...prev, [id]: doc }));
      setQueueDetailErrors((prev) => clearKey(prev, id));
    } catch (err) {
      setQueueDetailErrors((prev) => ({ ...prev, [id]: translateErr(err) }));
    }
  }, [translateErr]);

  const loadOutreachDetail = useCallback(async (id: string) => {
    try {
      const proposal = await api<OutreachProposalDetailDto>(`/v1/outreach/proposals/${id}`);
      setOutreachDetails((prev) => ({ ...prev, [id]: proposal }));
      setQueueDetailErrors((prev) => clearKey(prev, id));
    } catch (err) {
      setQueueDetailErrors((prev) => ({ ...prev, [id]: translateErr(err) }));
    }
  }, [translateErr]);

  const loadCmsPreviewLink = useCallback(async (id: string) => {
    try {
      const link = await api<CmsPreviewLink>(`/v1/cms/drafts/${id}/preview-link`, {
        method: 'POST',
        body: '{}',
      });
      setCmsPreviewLinks((prev) => ({ ...prev, [id]: link }));
    } catch {
      setCmsPreviewLinks((prev) => ({ ...prev, [id]: { url: null, deliveryUrl: null } }));
    }
  }, []);

  const reloadCmsPreviewLink = useCallback(
    async (id: string) => {
      setCmsPreviewLinks((prev) => clearKey(prev, id));
      await loadCmsPreviewLink(id);
    },
    [loadCmsPreviewLink],
  );

  const reloadQueueDetail = useCallback((id: string) => {
    setQueueDetailErrors((prev) => clearKey(prev, id));
  }, []);

  const cmsDetailId =
    activeQueueItem?.kind === 'cms'
      ? activeQueueItem.id
      : activeScheduledItem?.kind === 'cms'
        ? activeScheduledItem.id
        : null;

  useEffect(() => {
    if (cmsDetailId === null) return;
    if (cmsDetails[cmsDetailId] !== undefined) return;
    if (queueDetailErrors[cmsDetailId]) return;
    void loadCmsDetail(cmsDetailId);
  }, [cmsDetailId, cmsDetails, queueDetailErrors, loadCmsDetail]);

  useEffect(() => {
    if (!activeQueueItem || activeQueueItem.kind !== 'outreach') return;
    const id = activeQueueItem.id;
    if (viewedProposals.current.has(id)) return;
    viewedProposals.current.add(id);
    void api(`/v1/outreach/proposals/${id}/viewed`, { method: 'POST' }).catch(() => {
      viewedProposals.current.delete(id);
    });
  }, [activeQueueItem]);

  useEffect(() => {
    if (!activeQueueItem || activeQueueItem.kind !== 'outreach') return;
    const id = activeQueueItem.id;
    if (outreachDetails[id] !== undefined) return;
    if (queueDetailErrors[id]) return;
    void loadOutreachDetail(id);
  }, [activeQueueItem, outreachDetails, queueDetailErrors, loadOutreachDetail]);

  useEffect(() => {
    if (!activeQueueItem || activeQueueItem.kind !== 'cms') return;
    const id = activeQueueItem.id;
    if (cmsPreviewLinks[id] !== undefined) return;
    void loadCmsPreviewLink(id);
  }, [activeQueueItem, cmsPreviewLinks, loadCmsPreviewLink]);

  const subscriptions = useMemo<SubscriptionChannel[]>(() => [{ channel: 'org' }], []);

  const { status: connectionStatus } = useRealtime(subscriptions, (event) => {
    const matches =
      event.type.startsWith('conversation.') ||
      event.type.startsWith('kb.') ||
      event.type.startsWith('crm.merge_proposal.') ||
      event.type.startsWith('outreach.proposal.') ||
      event.type.startsWith('cms.entry.');
    if (matches) void loadInbox();
  });

  const wasOfflineRef = useRef(false);
  useEffect(() => {
    if (connectionStatus === 'offline') {
      wasOfflineRef.current = true;
      return;
    }
    if (connectionStatus === 'connected' && wasOfflineRef.current) {
      wasOfflineRef.current = false;
      void loadInbox();
    }
  }, [connectionStatus, loadInbox]);

  const approveQueue = useCallback(
    async (item: QueueItem, sendAt?: string | null) => {
      setPending(true);
      setQueueActionError(null);
      try {
        if (item.kind === 'kb' && item.raw.revisesDocumentId) {
          await api(`/v1/kb/curation/candidates/${item.id}/publish-revision`, {
            method: 'POST',
            body: JSON.stringify({
              ifCandidateVersion: item.raw.version,
              ifDocumentVersion: item.raw.revisesDocumentVersion,
            }),
          });
        } else if (item.kind === 'kb') {
          const targetSlug = item.raw.proposedTargetSpaceSlug ?? DEFAULT_CURATION_TARGET_SPACE;
          await api(`/v1/kb/curation/candidates/${item.id}/publish`, {
            method: 'POST',
            body: JSON.stringify({ targetSpaceSlug: targetSlug, ifVersion: item.raw.version }),
          });
        } else if (item.kind === 'crm') {
          await api(`/v1/crm/merge-proposals/${item.id}/apply`, {
            method: 'POST',
            body: JSON.stringify({ fingerprint: item.raw.mergeFingerprint }),
          });
        } else if (item.kind === 'feedback') {
          await api(`/v1/feedback/${item.id}/approve`, { method: 'POST' });
        } else if (item.kind === 'cms') {
          await api(`/v1/cms/drafts/${item.id}/approve`, { method: 'POST', body: '{}' });
        } else {
          await api(`/v1/outreach/proposals/${item.id}/approve`, {
            method: 'POST',
            body: JSON.stringify({
              fingerprint: item.raw.draftFingerprint,
              ...(sendAt === undefined ? {} : { sendAt }),
            }),
          });
        }
        await loadInbox();
        setActiveQueueItem(null);
        return true;
      } catch (err) {
        setQueueActionError({
          type: 'approve',
          itemId: item.id,
          message: translateErr(err),
          code: getErrorCode(err),
        });
        return false;
      } finally {
        setPending(false);
      }
    },
    [loadInbox, translateErr],
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
        } else if (item.kind === 'outreach') {
          await api(`/v1/outreach/proposals/${item.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ draftBody: body }),
          });
        }
        await loadInbox();
      } catch (err) {
        notify.error(translateErr(err));
        throw err;
      } finally {
        setPending(false);
      }
    },
    [loadInbox, translateErr],
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
          notify.error(translateErr(err));
        }
        throw err;
      } finally {
        setPending(false);
      }
    },
    [loadInbox, translateErr],
  );

  const uploadCmsAsset = useCallback(
    async (item: QueueItem, file: File): Promise<CmsAssetExpanded> => {
      if (item.kind !== 'cms') {
        throw new Error(`uploadCmsAsset called for non-cms item: ${item.kind}`);
      }
      setPending(true);
      try {
        const prepared = await prepareImageForUpload(file);
        const handle = await api<
          { id: string; publicUrl: string; altText: string | null } & PresignedUploadTarget
        >(`/v1/cms/drafts/${item.id}/assets/upload-request`, {
          method: 'POST',
          body: JSON.stringify({
            name: prepared.name,
            mime: prepared.mime,
            sizeBytes: prepared.blob.size,
          }),
        });
        await uploadToPresigned(handle, prepared);
        const asset = await api<{ id: string; publicUrl: string; altText: string | null }>(
          `/v1/cms/drafts/${item.id}/assets/${handle.id}/complete`,
          { method: 'POST', body: '{}' },
        );
        return { id: asset.id, publicUrl: asset.publicUrl, altText: asset.altText };
      } catch (err) {
        notify.error(translateErr(err));
        throw err;
      } finally {
        setPending(false);
      }
    },
    [translateErr],
  );

  const dismissQueue = useCallback(
    async (item: QueueItem) => {
      setPending(true);
      setQueueActionError(null);
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
        setActiveQueueItem(null);
        return true;
      } catch (err) {
        setQueueActionError({
          type: 'dismiss',
          itemId: item.id,
          message: translateErr(err),
          code: getErrorCode(err),
        });
        return false;
      } finally {
        setPending(false);
      }
    },
    [loadInbox, translateErr],
  );

  const cancelScheduledSend = useCallback(
    async (id: string, reason: string) => {
      setPending(true);
      try {
        await api(`/v1/outreach/proposals/${id}/cancel-scheduled-send`, {
          method: 'POST',
          body: JSON.stringify({ reason }),
        });
        setActiveScheduledItem(null);
        setCancelTarget(null);
        await loadInbox();
      } catch (err) {
        notify.error(translateErr(err));
        throw err;
      } finally {
        setPending(false);
      }
    },
    [loadInbox, translateErr],
  );

  const cancelScheduledPublish = useCallback(
    async (id: string) => {
      setPending(true);
      try {
        await api(`/v1/cms/drafts/${id}/unschedule`, { method: 'POST', body: '{}' });
        setCmsDetails((prev) => clearKey(prev, id));
        setActiveScheduledItem(null);
        setCancelTarget(null);
        await loadInbox();
      } catch (err) {
        notify.error(translateErr(err));
        throw err;
      } finally {
        setPending(false);
      }
    },
    [loadInbox, translateErr],
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
        setActiveQueueItem(null);
      } catch (err) {
        notify.error(translateErr(err));
        throw err;
      } finally {
        setPending(false);
      }
    },
    [loadInbox, translateErr],
  );

  return {
    items,
    itemsTotal,
    queue,
    pending,
    loadError,
    hasLoadedOnce,
    retrying,
    retryLoad,
    activeQueueItem,
    setActiveQueueItem,
    activeScheduledItem,
    setActiveScheduledItem,
    cancelTarget,
    setCancelTarget,
    cmsDetails,
    outreachDetails,
    cmsPreviewLinks,
    reloadCmsPreviewLink,
    queueDetailErrors,
    reloadQueueDetail,
    queueActionError,
    clearQueueActionError,
    approveQueue,
    scheduled,
    cancelScheduledSend,
    cancelScheduledPublish,
    saveQueue,
    saveCmsDraft,
    uploadCmsAsset,
    dismissQueue,
    scheduleQueue,
  };
}
