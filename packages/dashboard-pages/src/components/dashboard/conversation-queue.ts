'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { api, ApiError } from '../../api';
import { getErrorCode, useTranslateError } from '../../i18n/translate-error';
import { notify } from '../../lib/notify';
import { useRealtime, type SubscriptionChannel } from '../../realtime';
import type { ConversationDetail, MessageDto, Status } from './inbox-types';

const DRAFT_REQUEST_TIMEOUT_MS = 60_000;
const RUNNER_PICKUP_POLL_MS = 1_500;
const AGENT_WORKING_POLL_MS = 2_000;

export interface QueueClaim {
  holderId: string;
  holderName: string | null;
  expiresAt: string;
}

export interface QueueItemDto {
  id: string;
  displayId: number;
  status: Status;
  channelId: string;
  channelType: string;
  endUserId: string | null;
  contactId: string | null;
  topicId: string | null;
  assigneeUserId: string | null;
  subject: string | null;
  lastMessageAt: string | null;
  lastInboundPreview?: string | null;
  needsHumanAttention: boolean;
  needsHumanAttentionAt: string | null;
  agentMode: 'auto' | 'draft_only' | 'off';
  customerName: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  topicName: string | null;
  topicSlug: string | null;
  topicAgentMode: 'auto' | 'draft_only' | 'off' | null;
  claim: QueueClaim | null;
  noteCount: number;
  hasPendingDraft: boolean;
  endUserSpokeLast?: boolean;
  agentWorking?: boolean;
}

interface QueuePageResponse {
  items: QueueItemDto[];
  nextCursor: string | null;
}

export interface QueueCounts {
  needsYou: number;
  inProgress: number;
  total: number;
}

export type QueueActionType =
  | 'send'
  | 'takeOver'
  | 'release'
  | 'close'
  | 'reopen'
  | 'reject'
  | 'note'
  | 'requestDraft'
  | 'attach'
  | 'retryDelivery';

export type QueueActionError = {
  type: QueueActionType;
  conversationId: string;
  message: string;
  code: string | null;
} | null;

export const FINISHED_MIN_ITEMS = 25;
export const FINISHED_WINDOW_DAYS = 7;

const FINISHED_FETCH_LIMIT = 100;
const OPEN_PAGE_LIMIT = 100;

function queueUrl(status: 'open' | 'closed', limit: number, cursor?: string | null): string {
  const params = new URLSearchParams({ status, limit: String(limit) });
  if (cursor) params.set('cursor', cursor);
  return `/v1/conversations/queue?${params.toString()}`;
}

function dedupeById(items: QueueItemDto[]): QueueItemDto[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

export async function loadOpenPages(
  pages: number,
): Promise<{ items: QueueItemDto[]; nextCursor: string | null }> {
  const items: QueueItemDto[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < pages; i += 1) {
    const page: QueuePageResponse = await api<QueuePageResponse>(
      queueUrl('open', OPEN_PAGE_LIMIT, cursor),
    );
    items.push(...page.items);
    cursor = page.nextCursor;
    if (!cursor) break;
  }
  return { items: dedupeById(items), nextCursor: cursor };
}

export function visibleFinished(
  finished: QueueItemDto[],
  now = Date.now(),
): QueueItemDto[] {
  const cutoff = now - FINISHED_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  return finished.filter((item, index) => {
    if (index < FINISHED_MIN_ITEMS) return true;
    const at = item.lastMessageAt ? new Date(item.lastMessageAt).getTime() : NaN;
    return Number.isFinite(at) && at >= cutoff;
  });
}

export interface QueueSections {
  needsYou: QueueItemDto[];
  inProgress: QueueItemDto[];
  finished: QueueItemDto[];
}

export function partitionQueue(
  open: QueueItemDto[],
  finished: QueueItemDto[],
  viewerUserId: string | null,
): QueueSections {
  const needsYou: QueueItemDto[] = [];
  const inProgress: QueueItemDto[] = [];
  for (const item of open) {
    const mine = !!item.claim && item.claim.holderId === viewerUserId;
    if (mine || (item.needsHumanAttention && !item.claim)) needsYou.push(item);
    else inProgress.push(item);
  }
  return { needsYou, inProgress, finished: visibleFinished(finished) };
}

export function matchesQueueSearch(item: QueueItemDto, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [
    item.customerName,
    item.customerEmail,
    item.customerPhone,
    item.subject,
    item.lastInboundPreview,
    item.topicName,
  ]
    .filter((v): v is string => typeof v === 'string')
    .some((v) => v.toLowerCase().includes(q));
}

const DRAFT_KINDS = ['draft_reply', 'draft_reply_sent', 'draft_reply_superseded', 'draft_reply_rejected'];

export function messageDraftKind(message: MessageDto): string | null {
  if (!message.internal || message.authorType !== 'agent') return null;
  const kind = message.metadata?.['kind'];
  return typeof kind === 'string' && DRAFT_KINDS.includes(kind) ? kind : null;
}

export function pendingDraftOf(detail: ConversationDetail | undefined): MessageDto | null {
  if (!detail) return null;
  return (
    detail.messages
      .slice()
      .reverse()
      .find((m) => messageDraftKind(m) === 'draft_reply') ?? null
  );
}

export interface QueueController {
  open: QueueItemDto[];
  finished: QueueItemDto[];
  counts: QueueCounts | null;
  hasMoreOpen: boolean;
  loadingMore: boolean;
  loadMoreOpen: () => Promise<void>;
  selectedId: string | null;
  details: Record<string, ConversationDetail>;
  detailErrors: Record<string, ApiError>;
  retryDetail: (id: string) => Promise<void>;
  loadError: ApiError | null;
  hasLoadedOnce: boolean;
  retrying: boolean;
  retryLoad: () => Promise<void>;
  pending: boolean;
  pendingAction: QueueActionType | null;
  actionError: QueueActionError;
  clearActionError: () => void;
  reportAttachmentError: (conversationId: string, message: string) => void;
  draftRequested: Record<string, boolean>;
  takeOver: (id: string) => Promise<void>;
  release: (id: string) => Promise<boolean>;
  closeConv: (id: string) => Promise<boolean>;
  reopenConv: (id: string) => Promise<void>;
  send: (
    id: string,
    body: string,
    fromDraftId?: string,
    attachmentIds?: string[],
  ) => Promise<boolean>;
  deleteAttachment: (conversationId: string, attachmentId: string) => Promise<boolean>;
  retryDelivery: (conversationId: string, messageId: string) => Promise<boolean>;
  addNote: (id: string, body: string) => Promise<boolean>;
  rejectDraft: (id: string) => Promise<void>;
  requestDraft: (id: string) => Promise<void>;
}

export function useConversationQueue(routeSelectedId: string | null): QueueController {
  const translateErr = useTranslateError();
  const t = useTranslations('dashboard.console.queue');
  const [open, setOpen] = useState<QueueItemDto[]>([]);
  const [finished, setFinished] = useState<QueueItemDto[]>([]);
  const [counts, setCounts] = useState<QueueCounts | null>(null);
  const [openCursor, setOpenCursor] = useState<string | null>(null);
  const openCursorRef = useRef(openCursor);
  openCursorRef.current = openCursor;
  const openPagesRef = useRef(1);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingMoreRef = useRef(loadingMore);
  loadingMoreRef.current = loadingMore;
  const selectedId = routeSelectedId ?? open[0]?.id ?? finished[0]?.id ?? null;
  const [details, setDetails] = useState<Record<string, ConversationDetail>>({});
  const [detailErrors, setDetailErrors] = useState<Record<string, ApiError>>({});
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [pendingAction, setPendingAction] = useState<QueueActionType | null>(null);
  const [actionError, setActionError] = useState<QueueActionError>(null);
  const [draftRequested, setDraftRequested] = useState<Record<string, boolean>>({});
  const draftRequestedRef = useRef(draftRequested);
  draftRequestedRef.current = draftRequested;
  const draftTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const followUpTimers = useRef(new Set<ReturnType<typeof setTimeout>>());

  const clearDraftRequested = useCallback((id: string) => {
    const timer = draftTimers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      draftTimers.current.delete(id);
    }
    setDraftRequested((prev) => {
      if (!prev[id]) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  useEffect(() => {
    const timers = draftTimers.current;
    const followUps = followUpTimers.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      for (const timer of followUps) clearTimeout(timer);
      followUps.clear();
    };
  }, []);

  const loadQueue = useCallback(async () => {
    try {
      const [openPages, openCounts, finishedPage] = await Promise.all([
        loadOpenPages(openPagesRef.current),
        api<QueueCounts>('/v1/conversations/queue/counts'),
        api<QueuePageResponse>(queueUrl('closed', FINISHED_FETCH_LIMIT)),
      ]);
      setOpen(openPages.items);
      setOpenCursor(openPages.nextCursor);
      setCounts(openCounts);
      setFinished(finishedPage.items);
      setLoadError(null);
      setHasLoadedOnce(true);
      for (const item of openPages.items) {
        if (item.hasPendingDraft && draftRequestedRef.current[item.id]) {
          clearDraftRequested(item.id);
        }
      }
    } catch (err) {
      if (err instanceof ApiError) setLoadError(err);
    }
  }, [clearDraftRequested]);

  const loadMoreOpen = useCallback(async () => {
    const cursor = openCursorRef.current;
    if (!cursor || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const page = await api<QueuePageResponse>(queueUrl('open', OPEN_PAGE_LIMIT, cursor));
      openPagesRef.current += 1;
      setOpen((prev) => dedupeById([...prev, ...page.items]));
      setOpenCursor(page.nextCursor);
    } catch (err) {
      if (err instanceof ApiError) setLoadError(err);
    } finally {
      setLoadingMore(false);
    }
  }, []);

  const retryLoad = useCallback(async () => {
    setRetrying(true);
    try {
      await loadQueue();
    } finally {
      setRetrying(false);
    }
  }, [loadQueue]);

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
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
      if (
        draftRequestedRef.current[id] &&
        d.messages.some((m) => messageDraftKind(m) === 'draft_reply')
      ) {
        clearDraftRequested(id);
      }
    } catch (err) {
      if (err instanceof ApiError) setDetailErrors((prev) => ({ ...prev, [id]: err }));
    }
  }, [clearDraftRequested]);

  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  useEffect(() => {
    if (selectedId) void loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  useEffect(() => {
    if (!open.some((item) => item.agentWorking)) return;
    const timer = setTimeout(() => void loadQueue(), AGENT_WORKING_POLL_MS);
    return () => clearTimeout(timer);
  }, [open, loadQueue]);

  const subscriptions = useMemo<SubscriptionChannel[]>(() => {
    const subs: SubscriptionChannel[] = [{ channel: 'org' }];
    if (selectedId) subs.push({ channel: 'conversation', id: selectedId });
    return subs;
  }, [selectedId]);

  const { status: connectionStatus } = useRealtime(subscriptions, (event) => {
    if (!event.type.startsWith('conversation.')) return;
    void loadQueue();
    const eventConvId = event.payload['conversationId'];
    if (typeof eventConvId === 'string' && eventConvId === selectedId) void loadDetail(eventConvId);
    if (event.type === 'conversation.message.received') {
      const timer = setTimeout(() => {
        followUpTimers.current.delete(timer);
        void loadQueue();
      }, RUNNER_PICKUP_POLL_MS);
      followUpTimers.current.add(timer);
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
      void loadQueue();
      if (selectedId) void loadDetail(selectedId);
    }
  }, [connectionStatus, selectedId, loadDetail, loadQueue]);

  const runAction = useCallback(
    async (
      type: QueueActionType,
      id: string,
      fn: () => Promise<void>,
    ): Promise<boolean> => {
      setPendingAction(type);
      setActionError(null);
      try {
        await fn();
        await Promise.all([loadQueue(), loadDetail(id)]);
        return true;
      } catch (err) {
        setActionError({
          type,
          conversationId: id,
          message: translateErr(err),
          code: getErrorCode(err),
        });
        return false;
      } finally {
        setPendingAction(null);
      }
    },
    [loadDetail, loadQueue, translateErr],
  );

  const takeOver = useCallback(
    async (id: string) => {
      await runAction('takeOver', id, () =>
        api(`/v1/conversations/${id}/take-over`, { method: 'POST', body: '{}' }),
      );
    },
    [runAction],
  );

  const release = useCallback(
    async (id: string) =>
      runAction('release', id, () =>
        api(`/v1/conversations/${id}/release`, { method: 'POST', body: '{}' }),
      ),
    [runAction],
  );

  const closeConv = useCallback(
    async (id: string) =>
      runAction('close', id, () =>
        api(`/v1/conversations/${id}/status`, {
          method: 'POST',
          body: JSON.stringify({ status: 'closed' }),
        }),
      ),
    [runAction],
  );

  const reopenConv = useCallback(
    async (id: string) => {
      await runAction('reopen', id, () =>
        api(`/v1/conversations/${id}/status`, {
          method: 'POST',
          body: JSON.stringify({ status: 'open' }),
        }),
      );
    },
    [runAction],
  );

  const send = useCallback(
    async (id: string, body: string, fromDraftId?: string, attachmentIds?: string[]) => {
      const trimmed = body.trim();
      if (!trimmed) return false;
      return runAction('send', id, () =>
        api(`/v1/conversations/${id}/messages`, {
          method: 'POST',
          body: JSON.stringify({
            body: trimmed,
            ...(fromDraftId ? { fromDraftId } : {}),
            ...(attachmentIds?.length ? { attachmentIds } : {}),
          }),
        }),
      );
    },
    [runAction],
  );

  const deleteAttachment = useCallback(
    async (conversationId: string, attachmentId: string) =>
      runAction('attach', conversationId, () =>
        api(`/v1/conversations/${conversationId}/attachments/${attachmentId}`, {
          method: 'DELETE',
        }),
      ),
    [runAction],
  );

  const retryDelivery = useCallback(
    async (conversationId: string, messageId: string) =>
      runAction('retryDelivery', conversationId, () =>
        api(`/v1/conversations/${conversationId}/messages/${messageId}/retry-delivery`, {
          method: 'POST',
          body: '{}',
        }),
      ),
    [runAction],
  );

  const addNote = useCallback(
    async (id: string, body: string) => {
      const trimmed = body.trim();
      if (!trimmed) return false;
      return runAction('note', id, () =>
        api(`/v1/conversations/${id}/messages`, {
          method: 'POST',
          body: JSON.stringify({ body: trimmed, internal: true }),
        }),
      );
    },
    [runAction],
  );

  const rejectDraft = useCallback(
    async (id: string) => {
      await runAction('reject', id, () =>
        api(`/v1/conversations/${id}/clear-draft`, { method: 'POST', body: '{}' }),
      );
    },
    [runAction],
  );

  const requestDraft = useCallback(
    async (id: string) => {
      const ok = await runAction('requestDraft', id, () =>
        api(`/v1/conversations/${id}/request-draft`, { method: 'POST', body: '{}' }),
      );
      if (!ok) return;
      const existing = draftTimers.current.get(id);
      if (existing) clearTimeout(existing);
      setDraftRequested((prev) => ({ ...prev, [id]: true }));
      draftTimers.current.set(
        id,
        setTimeout(() => {
          draftTimers.current.delete(id);
          if (!draftRequestedRef.current[id]) return;
          setDraftRequested((prev) => {
            const next = { ...prev };
            delete next[id];
            return next;
          });
          notify.error(t('draftTimeout'));
        }, DRAFT_REQUEST_TIMEOUT_MS),
      );
    },
    [runAction, t],
  );

  const clearActionError = useCallback(() => setActionError(null), []);

  const reportAttachmentError = useCallback((conversationId: string, message: string) => {
    setActionError({ type: 'attach', conversationId, message, code: null });
  }, []);

  return {
    open,
    finished,
    counts,
    hasMoreOpen: openCursor !== null,
    loadingMore,
    loadMoreOpen,
    selectedId,
    details,
    detailErrors,
    retryDetail: loadDetail,
    loadError,
    hasLoadedOnce,
    retrying,
    retryLoad,
    pending: pendingAction !== null,
    pendingAction,
    actionError,
    clearActionError,
    reportAttachmentError,
    draftRequested,
    takeOver,
    release,
    closeConv,
    reopenConv,
    send,
    deleteAttachment,
    retryDelivery,
    addNote,
    rejectDraft,
    requestDraft,
  };
}
