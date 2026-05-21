'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Pill } from '@getmunin/ui';
import { api } from '../../api';
import { useRelative } from '../../lib/use-relative';
import { useRealtime, type RealtimeEventRow, type SubscriptionChannel } from '../../realtime';
import {
  eventDetail,
  eventLabelKey,
  eventTone,
  type EventTone,
} from '../../lib/event-display';

const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ITEMS = 10;
const FETCH_LIMIT = 50;
const EVICT_INTERVAL_MS = 60_000;

type ActorKind = 'user' | 'agent' | 'widget' | 'system' | 'unknown';

interface ActivityDto {
  id: string;
  type: string;
  actorId: string | null;
  actorKind: ActorKind | null;
  actorLabel: string | null;
  correlationId: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
}

interface ActivityPageResponse {
  items: ActivityDto[];
  nextCursor: string | null;
}

function fromRealtime(row: RealtimeEventRow): ActivityDto {
  return {
    id: row.id,
    type: row.type,
    actorId: row.actor_id,
    actorKind: null,
    actorLabel: null,
    correlationId: row.correlation_id,
    payload: row.payload,
    createdAt: row.created_at,
  };
}

export function LatestActivitySection() {
  const t = useTranslations('dashboard.overview.latestActivity');
  const tTypes = useTranslations('dashboard.activity.types');
  const [items, setItems] = useState<ActivityDto[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    void (async () => {
      try {
        const page = await api<ActivityPageResponse>(
          `/api/v1/activity?limit=${FETCH_LIMIT}`,
        );
        setItems(page.items);
      } catch {
        // intentionally silent — section just stays hidden
      }
    })();
  }, []);

  const subscriptions = useMemo<SubscriptionChannel[]>(() => [{ channel: 'org' }], []);
  useRealtime(subscriptions, (row) => {
    const next = fromRealtime(row);
    setItems((prev) => {
      if (prev.some((e) => e.id === next.id)) return prev;
      return [next, ...prev].slice(0, FETCH_LIMIT);
    });
  });

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), EVICT_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  const visible = useMemo(() => {
    const cutoff = now - WINDOW_MS;
    return items
      .filter((e) => new Date(e.createdAt).getTime() >= cutoff)
      .slice(0, MAX_ITEMS);
  }, [items, now]);

  if (visible.length === 0) return null;

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute">
          {t('eyebrow')} · {visible.length}
        </h2>
        <span className="font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute">
          {t('meta')}
        </span>
      </div>
      <ul className="border-t-[0.5px] border-rule-soft dark:border-rule-on-dark">
        {visible.map((event) => (
          <ActivityRow key={event.id} event={event} tTypes={tTypes} />
        ))}
      </ul>
    </section>
  );
}

function ActivityRow({
  event,
  tTypes,
}: {
  event: ActivityDto;
  tTypes: (key: string, values?: Record<string, string | number>) => string;
}) {
  const age = useRelative();
  const tone: EventTone = eventTone(event.type);
  const title = safeTypeLabel(event.type, tTypes);
  const detail = eventDetail(event, tTypes);

  return (
    <li>
      <div className="flex items-center gap-4 border-b-[0.5px] border-rule-soft px-4 py-3 dark:border-rule-on-dark">
        <span className="shrink-0">
          <Pill tone={tone}>{shortToneLabel(tone)}</Pill>
        </span>
        <div className="min-w-0 flex-1">
          <span className="text-sm font-medium text-ink dark:text-foreground">{title}</span>
          {detail ? (
            <span className="ml-2 text-sm text-ink-mute"> — {detail}</span>
          ) : null}
        </div>
        <span className="shrink-0 font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute">
          {age(event.createdAt)}
        </span>
      </div>
    </li>
  );
}

function safeTypeLabel(
  type: string,
  tTypes: (key: string, values?: Record<string, string | number>) => string,
): string {
  const key = eventLabelKey(type).replace(/^dashboard\.activity\.types\./, '');
  try {
    return tTypes(key);
  } catch {
    return type;
  }
}

function shortToneLabel(tone: EventTone): string {
  switch (tone) {
    case 'conv':
      return 'CONV';
    case 'kb':
      return 'KB';
    case 'crm':
      return 'CRM';
    case 'out':
      return 'OUT';
  }
}
