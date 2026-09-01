'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../../api';

export const DECIDED_LIMIT = 200;
export const DECIDED_WINDOW_DAYS = 7;

export function withinDecidedWindow(decidedAt: string, now = Date.now()): boolean {
  return now - new Date(decidedAt).getTime() <= DECIDED_WINDOW_DAYS * 24 * 60 * 60 * 1000;
}

export interface CurationDecisionDto {
  id: string;
  sourceConversationId: string | null;
  sourceMessageId: string | null;
  candidateDocumentId: string;
  title: string;
  outcome: 'published' | 'dismissed';
  reason: string | null;
  publishedDocumentId: string | null;
  decidedByActorType: string;
  decidedByActorId: string;
  decidedByName: string | null;
  decidedAt: string;
}

export interface PublishedDocument {
  id: string;
  title: string;
  body: string;
  slug: string | null;
  tags: string[];
}

export interface CurationDecisionsController {
  items: CurationDecisionDto[];
  hasLoadedOnce: boolean;
  loadError: ApiError | null;
  retrying: boolean;
  retryLoad: () => Promise<void>;
  reload: () => Promise<void>;
  publishedDocs: Record<string, PublishedDocument>;
  publishedDocErrors: Record<string, ApiError>;
  loadPublishedDoc: (id: string) => Promise<void>;
}

export function useCurationDecisions(): CurationDecisionsController {
  const [items, setItems] = useState<CurationDecisionDto[]>([]);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [publishedDocs, setPublishedDocs] = useState<Record<string, PublishedDocument>>({});
  const [publishedDocErrors, setPublishedDocErrors] = useState<Record<string, ApiError>>({});

  const load = useCallback(async () => {
    try {
      const res = await api<{ items: CurationDecisionDto[] }>(
        `/v1/kb/curation/decisions?limit=${DECIDED_LIMIT}`,
      );
      setItems(res.items);
      setLoadError(null);
      setHasLoadedOnce(true);
    } catch (err) {
      if (err instanceof ApiError) setLoadError(err);
    }
  }, []);

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

  useEffect(() => {
    void load();
  }, [load]);

  return {
    items,
    hasLoadedOnce,
    loadError,
    retrying,
    retryLoad,
    reload: load,
    publishedDocs,
    publishedDocErrors,
    loadPublishedDoc,
  };
}
