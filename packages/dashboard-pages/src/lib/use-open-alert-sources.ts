'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api';
import { useRealtime } from '../realtime';

const ALERT_EVENTS = new Set(['org_alert.opened', 'org_alert.resolved']);

export function useOpenAlertSources(enabled: boolean): ReadonlySet<string> {
  const [sources, setSources] = useState<ReadonlySet<string>>(() => new Set());
  const cancelledRef = useRef(false);

  const fetchSources = useCallback(async () => {
    try {
      const res = await api<{ items: { source: string; resolvedAt: string | null }[] }>(
        '/v1/system/alerts',
      );
      if (cancelledRef.current) return;
      setSources(new Set(res.items.filter((a) => a.resolvedAt === null).map((a) => a.source)));
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) return;
    }
  }, []);

  useRealtime(
    [{ channel: 'org' }],
    (event) => {
      if (ALERT_EVENTS.has(event.type)) void fetchSources();
    },
    { enabled },
  );

  useEffect(() => {
    if (!enabled) return;
    cancelledRef.current = false;
    void fetchSources();
    return () => {
      cancelledRef.current = true;
    };
  }, [enabled, fetchSources]);

  return sources;
}
