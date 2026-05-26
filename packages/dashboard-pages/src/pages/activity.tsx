'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Hero } from '@getmunin/ui';
import { api } from '../api';
import { useRealtime, type RealtimeEventRow, type SubscriptionChannel } from '../realtime';
import { LoadFailed } from '../components/load-failed';
import { useLoadGate } from '../lib/use-load-gate';
import { useSettingsLoadFailedProps } from '../lib/use-load-failed-props';

const WINDOW_MS = 30 * 60_000;
const EVICT_INTERVAL_MS = 5_000;
const MAX_ITEMS = 200;

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

function actorKindFromId(id: string): ActorKind {
  if (id.startsWith('usr_')) return 'user';
  if (id.startsWith('agt_')) return 'agent';
  if (id.startsWith('mn_widge_') || id.startsWith('akey_')) return 'widget';
  if (id === 'system') return 'system';
  return 'unknown';
}

function fromRealtime(
  row: RealtimeEventRow,
  cache: Map<string, { kind: ActorKind; label: string }>,
): ActivityDto {
  const resolved = row.actor_id ? cache.get(row.actor_id) : null;
  const kind = row.actor_id ? (resolved?.kind ?? actorKindFromId(row.actor_id)) : null;
  return {
    id: row.id,
    type: row.type,
    actorId: row.actor_id,
    actorKind: kind,
    actorLabel: resolved?.label ?? null,
    correlationId: row.correlation_id,
    payload: row.payload,
    createdAt: row.created_at,
  };
}

export function ActivityPage() {
  const t = useTranslations('dashboard.activity');
  const [items, setItems] = useState<ActivityDto[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const actorCache = useRef(new Map<string, { kind: ActorKind; label: string }>());

  const rememberActors = useCallback((rows: ActivityDto[]) => {
    for (const row of rows) {
      if (row.actorId && row.actorLabel && row.actorKind) {
        actorCache.current.set(row.actorId, { kind: row.actorKind, label: row.actorLabel });
      }
    }
  }, []);

  const fetchInitial = useCallback(async () => {
    const page = await api<ActivityPageResponse>(`/v1/activity?limit=${MAX_ITEMS}`);
    const cutoff = Date.now() - WINDOW_MS;
    const fresh = page.items
      .filter((e) => new Date(e.createdAt).getTime() >= cutoff)
      .slice(0, MAX_ITEMS);
    rememberActors(fresh);
    setItems(fresh);
  }, [rememberActors]);

  const { loadError, hasLoadedOnce, retrying, tryLoad, retry } = useLoadGate(fetchInitial);
  const buildLoadFailedProps = useSettingsLoadFailedProps();

  useEffect(() => {
    void tryLoad();
  }, [tryLoad]);

  const subscriptions = useMemo<SubscriptionChannel[]>(() => [{ channel: 'org' }], []);
  useRealtime(subscriptions, (row) => {
    const next = fromRealtime(row, actorCache.current);
    setItems((prev) => {
      if (prev.some((e) => e.id === next.id)) return prev;
      return [next, ...prev].slice(0, MAX_ITEMS);
    });
  });

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), EVICT_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  const visible = useMemo(() => {
    const cutoff = now - WINDOW_MS;
    return items.filter((e) => new Date(e.createdAt).getTime() >= cutoff);
  }, [items, now]);

  useEffect(() => {
    if (visible.length === items.length) return;
    setItems(visible);
  }, [visible, items.length]);

  if (loadError && !hasLoadedOnce) {
    return (
      <LoadFailed
        {...buildLoadFailedProps('activity', loadError, () => void retry(), retrying)}
      />
    );
  }

  return (
    <>
      <Hero
        eyebrow={t('eyebrow')}
        title={t.rich('title', { em: (chunks) => <em>{chunks}</em> })}
        lede={t('subtitle')}
      />

      <section data-screen-label="activity · feed">
        <header className="flex items-baseline justify-between border-b-[0.5px] border-rule-soft dark:border-rule-on-dark pb-2 mb-0">
          <h2 className="font-serif text-2xl leading-none">{t('liveStream')}</h2>
          <span className="font-mono text-[11px] uppercase tracking-eyebrow text-ink-mute">
            {t('windowLabel', { count: visible.length, minutes: WINDOW_MS / 60_000 })}
          </span>
        </header>

        <div className="bg-ink dark:bg-card text-paper dark:text-foreground font-mono text-[12px] leading-relaxed px-6 py-4 min-h-[12rem]">
          <div className="grid grid-cols-[6rem_minmax(0,11rem)_minmax(0,12rem)_1fr] gap-x-6 pb-2 mb-1 border-b-[0.5px] border-paper/15 dark:border-rule-on-dark text-[10px] uppercase tracking-eyebrow text-paper/45 dark:text-foreground/45">
            <span>{t('colTime')}</span>
            <span>{t('colType')}</span>
            <span>{t('colActor')}</span>
            <span>{t('colDetail')}</span>
          </div>
          <ul>
            {visible.map((e) => (
              <li
                key={e.id}
                className="grid grid-cols-[6rem_minmax(0,11rem)_minmax(0,12rem)_1fr] gap-x-6 items-baseline py-0.5"
              >
                <span className="text-paper/50 dark:text-foreground/50 whitespace-nowrap">
                  {formatClock(e.createdAt)}
                </span>
                <span className="truncate text-cobalt-soft">{e.type}</span>
                <span className="truncate text-paper/70 dark:text-foreground/70">
                  {formatActor(e)}
                </span>
                <span className="truncate text-paper/90 dark:text-foreground/90">{summary(e)}</span>
              </li>
            ))}
            {visible.length === 0 && (
              <li className="py-8 text-center text-paper/50 dark:text-foreground/50">
                {t('empty')}
              </li>
            )}
          </ul>
        </div>
      </section>
    </>
  );
}

function formatActor(e: ActivityDto): string {
  if (!e.actorId) return '—';
  if (e.actorLabel) return e.actorLabel;
  if (e.actorKind === 'system') return 'system';
  return `${e.actorId.slice(0, 14)}…`;
}

function summary(e: ActivityDto): string {
  const cid = e.payload['conversationId'];
  if (typeof cid === 'string') return `conv=${cid.slice(0, 12)}…`;
  return JSON.stringify(e.payload).slice(0, 120);
}

function formatClock(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}
