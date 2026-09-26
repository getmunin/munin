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
  hasPendingDraft: boolean;
  endUserSpokeLast?: boolean;
  agentWorking?: boolean;
}

export const QUEUE_STATUS_FILTERS = ['any', 'open', 'snoozed', 'closed', 'spam'] as const;
export type QueueStatusFilter = (typeof QUEUE_STATUS_FILTERS)[number];

export const QUEUE_ORIGIN_FILTERS = [
  'any',
  'human',
  'auto',
  'auto_reply',
  'bounce',
  'no_reply_address',
  'spam_sender',
  'no_content',
] as const;
export type QueueOriginFilter = (typeof QUEUE_ORIGIN_FILTERS)[number];

export const QUEUE_CHANNEL_FILTERS = ['any', 'email', 'chat', 'sms', 'whatsapp', 'voice'] as const;
export type QueueChannelFilter = (typeof QUEUE_CHANNEL_FILTERS)[number];

export const QUEUE_SINCE_FILTERS = ['any', '1d', '7d', '30d'] as const;
export type QueueSinceFilter = (typeof QUEUE_SINCE_FILTERS)[number];

const SINCE_DAYS: Record<Exclude<QueueSinceFilter, 'any'>, number> = { '1d': 1, '7d': 7, '30d': 30 };

export interface QueueFilters {
  status: QueueStatusFilter;
  origin: QueueOriginFilter;
  channelType: QueueChannelFilter;
  topicId: string;
  since: QueueSinceFilter;
}

export const DEFAULT_QUEUE_FILTERS: QueueFilters = {
  status: 'any',
  origin: 'any',
  channelType: 'any',
  topicId: 'any',
  since: 'any',
};

export function activeQueueFilterCount(filters: QueueFilters): number {
  return (Object.keys(DEFAULT_QUEUE_FILTERS) as Array<keyof QueueFilters>).filter(
    (key) => filters[key] !== DEFAULT_QUEUE_FILTERS[key],
  ).length;
}

export function queueFiltersActive(filters: QueueFilters): boolean {
  return activeQueueFilterCount(filters) > 0;
}

export function buildQueueFilterQuery(
  filters: QueueFilters,
  now = Date.now(),
  search = '',
): string {
  const params = new URLSearchParams();
  if (filters.status !== 'any') params.set('status', filters.status);
  if (filters.origin === 'human') params.set('suppressedReason', 'none');
  else if (filters.origin === 'auto') params.set('suppressedReason', 'any');
  else if (filters.origin !== 'any') params.set('suppressedReason', filters.origin);
  if (filters.channelType !== 'any') params.set('channelType', filters.channelType);
  if (filters.topicId !== 'any') params.set('topicId', filters.topicId);
  if (filters.since !== 'any') {
    params.set('since', new Date(now - SINCE_DAYS[filters.since] * 86_400_000).toISOString());
  }
  if (search.trim()) params.set('q', search.trim());
  return params.toString();
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
  | 'spam'
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
  attempt: number;
} | null;

export const FINISHED_MIN_ITEMS = 25;
export const FINISHED_WINDOW_DAYS = 7;

const FINISHED_FETCH_LIMIT = 100;
const OPEN_PAGE_LIMIT = 100;
const SEARCH_DEBOUNCE_MS = 250;

const OPEN_QUERY = 'status=open';
const FINISHED_QUERY = 'status=closed';

function queueUrl(query: string, limit: number, cursor?: string | null): string {
  const params = new URLSearchParams(query);
  params.set('limit', String(limit));
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

export async function loadQueuePages(
  pages: number,
  query: string,
): Promise<{ items: QueueItemDto[]; nextCursor: string | null }> {
  const items: QueueItemDto[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < pages; i += 1) {
    const page: QueuePageResponse = await api<QueuePageResponse>(
      queueUrl(query, OPEN_PAGE_LIMIT, cursor),
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
  results: QueueItemDto[];
  filtersActive: boolean;
  open: QueueItemDto[];
  finished: QueueItemDto[];
  counts: QueueCounts | null;
  hasMore: boolean;
  loadingMore: boolean;
  loadMore: () => Promise<void>;
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
  takeOver: (id: string) => Promise<boolean>;
  release: (id: string) => Promise<boolean>;
  closeConv: (id: string) => Promise<boolean>;
  markSpam: (id: string) => Promise<boolean>;
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

function useDebounced(value: string, delayMs: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

export function useConversationQueue(
  routeSelectedId: string | null,
  filters: QueueFilters = DEFAULT_QUEUE_FILTERS,
  search = '',
): QueueController {
  const translateErr = useTranslateError();
  const t = useTranslations('dashboard.console.queue');
  const [open, setOpen] = useState<QueueItemDto[]>([]);
  const [finished, setFinished] = useState<QueueItemDto[]>([]);
  const [results, setResults] = useState<QueueItemDto[]>([]);
  const [counts, setCounts] = useState<QueueCounts | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;
  const pagesRef = useRef(1);
  const loadedQueryRef = useRef<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingMoreRef = useRef(loadingMore);
  loadingMoreRef.current = loadingMore;
  const filtersActive = queueFiltersActive(filters);
  const searchTerm = useDebounced(search, SEARCH_DEBOUNCE_MS).trim();
  const query = useMemo(
    () => buildQueueFilterQuery(filters, Date.now(), searchTerm),
    [filters, searchTerm],
  );
  const queryRef = useRef(query);
  queryRef.current = query;
  const selectedId =
    routeSelectedId ?? (query ? results[0]?.id : open[0]?.id ?? finished[0]?.id) ?? null;
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
    if (loadedQueryRef.current !== query) {
      loadedQueryRef.current = query;
      pagesRef.current = 1;
    }
    try {
      let loaded: QueueItemDto[];
      if (query) {
        const page = await loadQueuePages(pagesRef.current, query);
        setResults(page.items);
        setCursor(page.nextCursor);
        setOpen([]);
        setCounts(null);
        setFinished([]);
        loaded = page.items;
      } else {
        const [openPages, openCounts, finishedPage] = await Promise.all([
          loadQueuePages(pagesRef.current, OPEN_QUERY),
          api<QueueCounts>('/v1/conversations/queue/counts'),
          api<QueuePageResponse>(queueUrl(FINISHED_QUERY, FINISHED_FETCH_LIMIT)),
        ]);
        setResults([]);
        setOpen(openPages.items);
        setCursor(openPages.nextCursor);
        setCounts(openCounts);
        setFinished(finishedPage.items);
        loaded = openPages.items;
      }
      setLoadError(null);
      setHasLoadedOnce(true);
      for (const item of loaded) {
        if (item.hasPendingDraft && draftRequestedRef.current[item.id]) {
          clearDraftRequested(item.id);
        }
      }
    } catch (err) {
      if (err instanceof ApiError) setLoadError(err);
    }
  }, [clearDraftRequested, query]);

  const loadMore = useCallback(async () => {
    const next = cursorRef.current;
    if (!next || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const pageQuery = queryRef.current;
      const page = await api<QueuePageResponse>(
        queueUrl(pageQuery || OPEN_QUERY, OPEN_PAGE_LIMIT, next),
      );
      pagesRef.current += 1;
      const append = (prev: QueueItemDto[]) => dedupeById([...prev, ...page.items]);
      if (pageQuery) setResults(append);
      else setOpen(append);
      setCursor(page.nextCursor);
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
    if (![...open, ...results].some((item) => item.agentWorking)) return;
    const timer = setTimeout(() => void loadQueue(), AGENT_WORKING_POLL_MS);
    return () => clearTimeout(timer);
  }, [open, results, loadQueue]);

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
      try {
        await fn();
        setActionError(null);
        await Promise.all([loadQueue(), loadDetail(id)]);
        return true;
      } catch (err) {
        setActionError((prev) => ({
          type,
          conversationId: id,
          message: translateErr(err),
          code: getErrorCode(err),
          attempt:
            prev && prev.type === type && prev.conversationId === id ? prev.attempt + 1 : 1,
        }));
        return false;
      } finally {
        setPendingAction(null);
      }
    },
    [loadDetail, loadQueue, translateErr],
  );

  const takeOver = useCallback(
    async (id: string) =>
      runAction('takeOver', id, () =>
        api(`/v1/conversations/${id}/take-over`, { method: 'POST', body: '{}' }),
      ),
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

  const markSpam = useCallback(
    async (id: string) =>
      runAction('spam', id, () =>
        api(`/v1/conversations/${id}/status`, {
          method: 'POST',
          body: JSON.stringify({ status: 'spam' }),
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
    setActionError((prev) => ({
      type: 'attach',
      conversationId,
      message,
      code: null,
      attempt:
        prev && prev.type === 'attach' && prev.conversationId === conversationId
          ? prev.attempt + 1
          : 1,
    }));
  }, []);

  return {
    open,
    finished,
    results,
    filtersActive,
    counts,
    hasMore: cursor !== null,
    loadingMore,
    loadMore,
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
    markSpam,
    rejectDraft,
    requestDraft,
  };
}
