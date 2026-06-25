'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { api } from '../api';
import { useRealtime } from '../realtime';
import { LoadFailed } from '../components/load-failed';
import { Skeleton } from '../components/skeleton';
import { useLoadGate } from '../lib/use-load-gate';
import { useSettingsLoadFailedProps } from '../lib/use-load-failed-props';
import { Hero, cn } from '@getmunin/ui';

interface SummaryTile {
  current: number;
  previous: number;
  sparkline: number[];
}

interface UsageSummaryDto {
  mcpCalls: SummaryTile & { period: 'month' };
  apiCalls: SummaryTile & { period: 'month' };
  aiTokens: SummaryTile & { period: 'month' };
  conversations: SummaryTile & { period: 'month' };
  avgLatencyMs: SummaryTile & { period: '7d' };
}

interface AgentUsageDto {
  id: string;
  name: string;
  description: string | null;
  mcpCalls: number;
  avgLatencyMs: number | null;
}

interface UsageByAgentDto {
  rangeDays: number;
  agents: AgentUsageDto[];
}

export function UsagePage({ slot }: { slot?: ReactNode } = {}) {
  const t = useTranslations('dashboard.usage');
  const [summary, setSummary] = useState<UsageSummaryDto | null>(null);
  const [byAgent, setByAgent] = useState<UsageByAgentDto | null>(null);

  const load = useCallback(async () => {
    const [s, a] = await Promise.all([
      api<UsageSummaryDto>('/v1/usage/summary'),
      api<UsageByAgentDto>('/v1/usage/by-agent'),
    ]);
    setSummary(s);
    setByAgent(a);
  }, []);

  const { loadError, hasLoadedOnce, retrying, tryLoad, retry } = useLoadGate(load);
  const buildLoadFailedProps = useSettingsLoadFailedProps();

  useEffect(() => {
    void tryLoad();
  }, [tryLoad]);

  useRealtime([{ channel: 'org' }], () => {
    void tryLoad();
  });

  if (loadError && !hasLoadedOnce) {
    return (
      <LoadFailed
        {...buildLoadFailedProps('usage', loadError, () => void retry(), retrying)}
      />
    );
  }

  return (
    <div className="space-y-10">
      <Hero
        eyebrow={t('eyebrow')}
        title={t.rich('title', { em: (chunks) => <em>{chunks}</em> })}
        lede={t('subtitle')}
      />

      {slot}

      {!hasLoadedOnce ? (
        <UsageSkeleton />
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 border-l-[0.5px] border-t-[0.5px] border-rule-soft dark:border-rule-on-dark">
            <Tile
              label={t('tiles.mcpCalls')}
              period={t('tiles.thisMonth')}
              tile={summary?.mcpCalls}
              format={formatCount}
              mode="count"
            />
            <Tile
              label={t('tiles.apiCalls')}
              period={t('tiles.thisMonth')}
              tile={summary?.apiCalls}
              format={formatCount}
              mode="count"
            />
            <Tile
              label={t('tiles.aiTokens')}
              period={t('tiles.thisMonth')}
              tile={summary?.aiTokens}
              format={formatCount}
              mode="count"
            />
            <Tile
              label={t('tiles.conversations')}
              period={t('tiles.thisMonth')}
              tile={summary?.conversations}
              format={formatCount}
              mode="count"
            />
            <Tile
              label={t('tiles.avgLatency')}
              period={t('tiles.sevenDay')}
              tile={summary?.avgLatencyMs}
              format={formatLatency}
              mode="latency"
            />
          </div>

          <ByAgentSection data={byAgent} />
        </>
      )}
    </div>
  );
}

function UsageSkeleton() {
  return (
    <div role="status" aria-busy="true" className="space-y-10">
      <span className="sr-only">Loading…</span>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 border-l-[0.5px] border-t-[0.5px] border-rule-soft dark:border-rule-on-dark">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="flex min-h-[180px] flex-col gap-4 border-b-[0.5px] border-r-[0.5px] border-rule-soft bg-paper p-6 dark:border-rule-on-dark dark:bg-card"
          >
            <Skeleton className="h-2.5 w-24" />
            <Skeleton className="h-9 w-20" />
            <Skeleton className="mt-auto h-[42px] w-full" />
          </div>
        ))}
      </div>
      <div className="space-y-6">
        <Skeleton className="h-6 w-56" />
        <div className="border-t-[0.5px] border-rule-soft dark:border-rule-on-dark">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center justify-between gap-12 border-b-[0.5px] border-rule-soft px-1 py-5 dark:border-rule-on-dark"
            >
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-4 w-16" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Tile({
  label,
  period,
  tile,
  format,
  mode,
}: {
  label: string;
  period: string;
  tile: SummaryTile | undefined;
  format: (value: number) => string;
  mode: 'count' | 'latency';
}) {
  const t = useTranslations('dashboard.usage.tiles');
  const delta = useMemo(() => computeDelta(tile, mode), [tile, mode]);

  return (
    <div className="bg-paper dark:bg-card p-6 flex flex-col gap-4 min-h-[180px] border-r-[0.5px] border-b-[0.5px] border-rule-soft dark:border-rule-on-dark">
      <p className="font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute">
        {label} · {period}
      </p>
      <p className="font-serif text-4xl leading-none font-normal tracking-tight text-ink dark:text-foreground">
        {tile ? format(tile.current) : '—'}
      </p>
      <p className="font-mono text-[10px] uppercase tracking-eyebrow text-cobalt dark:text-cobalt-soft">
        {tile
          ? delta.direction === 'up'
            ? t('deltaUp', { value: delta.label })
            : delta.direction === 'down'
              ? t('deltaDown', { value: delta.label })
              : t('deltaFlat')
          : ' '}
      </p>
      <div className="mt-auto">
        <Sparkline values={tile?.sparkline ?? []} variant={mode === 'latency' ? 'ink' : 'cobalt'} />
      </div>
    </div>
  );
}

function ByAgentSection({ data }: { data: UsageByAgentDto | null }) {
  const t = useTranslations('dashboard.usage.byAgent');
  return (
    <section className="space-y-6">
      <div className="flex items-baseline justify-between">
        <h2 className="font-serif text-xl md:text-2xl leading-tight font-normal tracking-tight text-ink dark:text-foreground">
          {t('title')}
          <span className="text-ink-mute"> · {t('rangeLabel', { days: data?.rangeDays ?? 30 })}</span>
        </h2>
        <p className="font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute">
          {t('rightLabel')}
        </p>
      </div>

      <div className="border-t-[0.5px] border-rule-soft dark:border-rule-on-dark">
        <div className="grid grid-cols-[1fr_auto_auto] gap-x-12 px-1 py-3 border-b-[0.5px] border-rule-soft dark:border-rule-on-dark">
          <span className="font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute">
            {t('colAgent')}
          </span>
          <span className="font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute justify-self-end min-w-[7rem] text-right">
            {t('colMcpCalls')}
          </span>
          <span className="font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute justify-self-end min-w-[7rem] text-right">
            {t('colLatency')}
          </span>
        </div>

        {data && data.agents.length === 0 && (
          <p className="px-1 py-6 text-sm text-ink-mute">{t('empty')}</p>
        )}

        {data?.agents.map((agent) => (
          <div
            key={agent.id}
            className="grid grid-cols-[1fr_auto_auto] gap-x-12 items-baseline px-1 py-5 border-b-[0.5px] border-rule-soft dark:border-rule-on-dark"
          >
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-semibold text-ink dark:text-foreground">{agent.name}</span>
              {agent.description && (
                <span className="text-sm text-ink-mute">{agent.description}</span>
              )}
            </div>
            <span className="text-sm tabular-nums text-ink dark:text-foreground justify-self-end">
              {formatCount(agent.mcpCalls)}
            </span>
            <span className="text-sm tabular-nums text-ink-mute justify-self-end">
              {agent.avgLatencyMs == null ? '—' : formatLatency(agent.avgLatencyMs)}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function Sparkline({
  values,
  variant,
}: {
  values: number[];
  variant: 'cobalt' | 'ink';
}) {
  if (values.length < 2) {
    return <div className="h-[42px]" aria-hidden="true" />;
  }
  const width = 200;
  const height = 42;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const stepX = values.length > 1 ? width / (values.length - 1) : 0;
  const points = values
    .map((v, i) => {
      const x = i * stepX;
      const y = height - ((v - min) / span) * (height - 4) - 2;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="block w-full h-[42px]"
      aria-hidden="true"
    >
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        points={points}
        className={cn(
          variant === 'cobalt'
            ? 'text-cobalt dark:text-cobalt-soft'
            : 'text-ink dark:text-foreground',
        )}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function computeDelta(
  tile: SummaryTile | undefined,
  mode: 'count' | 'latency',
): { direction: 'up' | 'down' | 'flat'; label: string } {
  if (!tile) return { direction: 'flat', label: '' };
  const { current, previous } = tile;
  if (mode === 'latency') {
    if (previous === 0 || current === previous) return { direction: 'flat', label: '' };
    const diffMs = current - previous;
    return {
      direction: diffMs > 0 ? 'up' : 'down',
      label: formatLatencyDelta(Math.abs(diffMs)),
    };
  }
  if (previous === 0) {
    return current === 0 ? { direction: 'flat', label: '' } : { direction: 'up', label: 'new' };
  }
  const pct = Math.round(((current - previous) / previous) * 100);
  if (pct === 0) return { direction: 'flat', label: '' };
  return {
    direction: pct > 0 ? 'up' : 'down',
    label: `${Math.abs(pct)}%`,
  };
}

function formatCount(n: number): string {
  return n.toLocaleString('en-US');
}

function formatLatency(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms)}ms`;
}

function formatLatencyDelta(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms)}ms`;
}
