'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../../api';
import { useRealtime, type SubscriptionChannel } from '../../realtime';
import type { ReviewDecidedWireItem } from './inbox-types';

export const DECIDED_PAGE_SIZE = 50;

export { DECIDED_WINDOW_DAYS } from './decided-window';

export type ReviewDecidedItem = ReviewDecidedWireItem;

export interface PublishedDocument {
  id: string;
  title: string;
  body: string;
  slug: string | null;
  tags: string[];
}

export interface ReviewDecidedController {
  items: ReviewDecidedItem[];
  hasLoadedOnce: boolean;
  loadError: ApiError | null;
  retrying: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  loadMore: () => Promise<void>;
  retryLoad: () => Promise<void>;
  reload: () => Promise<void>;
  publishedDocs: Record<string, PublishedDocument>;
  publishedDocErrors: Record<string, ApiError>;
  loadPublishedDoc: (id: string) => Promise<void>;
}

interface DecidedPage {
  items: ReviewDecidedItem[];
  nextCursor: string | null;
}

export function useReviewDecided(): ReviewDecidedController {
  const [items, setItems] = useState<ReviewDecidedItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [publishedDocs, setPublishedDocs] = useState<Record<string, PublishedDocument>>({});
  const [publishedDocErrors, setPublishedDocErrors] = useState<Record<string, ApiError>>({});

  const fetchPage = useCallback(async (after: string | null): Promise<DecidedPage> => {
    const query = new URLSearchParams({ state: 'decided', limit: String(DECIDED_PAGE_SIZE) });
    if (after) query.set('cursor', after);
    return api<DecidedPage>(`/v1/review?${query.toString()}`);
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetchPage(null);
      setItems(res.items);
      setCursor(res.nextCursor);
      setLoadError(null);
      setHasLoadedOnce(true);
    } catch (err) {
      if (err instanceof ApiError) setLoadError(err);
    }
  }, [fetchPage]);

  const loadMore = useCallback(async () => {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const res = await fetchPage(cursor);
      setItems((prev) => {
        const seen = new Set(prev.map((i) => i.id));
        return [...prev, ...res.items.filter((i) => !seen.has(i.id))];
      });
      setCursor(res.nextCursor);
    } catch (err) {
      if (err instanceof ApiError) setLoadError(err);
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, fetchPage]);

  const retryLoad = useCallback(async () => {
    setRetrying(true);
    try {
      await load();
    } finally {
      setRetrying(false);
    }
  }, [load]);

  const loadPublishedDoc = useCallback(async (id: string) => {
    setPublishedDocErrors((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
    try {
      const doc = await api<PublishedDocument>(`/v1/kb/documents/${id}`);
      setPublishedDocs((prev) => ({ ...prev, [id]: doc }));
    } catch (err) {
      if (err instanceof ApiError) setPublishedDocErrors((prev) => ({ ...prev, [id]: err }));
    }
  }, []);

  const subscriptions = useMemo<SubscriptionChannel[]>(() => [{ channel: 'org' }], []);
  useRealtime(subscriptions, (event) => {
    const decided =
      event.type === 'kb.curation_candidate.published' ||
      event.type === 'kb.curation_candidate.dismissed' ||
      event.type === 'crm.merge_proposal.applied' ||
      event.type === 'crm.merge_proposal.dismissed' ||
      event.type === 'outreach.proposal.sent' ||
      event.type === 'outreach.proposal.dismissed' ||
      event.type === 'outreach.proposal.withdrawn' ||
      event.type === 'outreach.proposal.send_failed' ||
      event.type === 'cms.entry.published' ||
      event.type === 'cms.entry.archived' ||
      event.type.startsWith('feedback.item.');
    if (decided) void load();
  });

  useEffect(() => {
    void load();
  }, [load]);

  return {
    items,
    hasLoadedOnce,
    loadError,
    retrying,
    hasMore: cursor !== null,
    loadingMore,
    loadMore,
    retryLoad,
    reload: load,
    publishedDocs,
    publishedDocErrors,
    loadPublishedDoc,
  };
}
