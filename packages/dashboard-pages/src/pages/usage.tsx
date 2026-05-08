'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { api } from '../api';
import { useTranslateError } from '../i18n/translate-error';
import { useRealtime } from '../realtime';
import { Card, CardContent, Hero, cn } from '@getmunin/ui';

interface SummaryTile {
  current: number;
  previous: number;
  sparkline: number[];
}

interface UsageSummaryDto {
  mcpCalls: SummaryTile & { period: 'month' };
  apiCalls: SummaryTile & { period: 'month' };
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

export function UsagePage() {
  const t = useTranslations('dashboard.usage');
  const translate = useTranslateError();
  const [summary, setSummary] = useState<UsageSummaryDto | null>(null);
  const [byAgent, setByAgent] = useState<UsageByAgentDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, a] = await Promise.all([
        api<UsageSummaryDto>('/api/v1/usage/summary'),
        api<UsageByAgentDto>('/api/v1/usage/by-agent'),
      ]);
      setSummary(s);
      setByAgent(a);
      setError(null);
    } catch (err) {
      setError(translate(err) || t('errors.load'));
    }
  }, [t, translate]);

  useEffect(() => {
    void load();
  }, [load]);

  useRealtime([{ channel: 'org' }], () => {
    void load();
  });

  return (
    <div className="space-y-10">
      <Hero title={t('title')} lede={t('subtitle')} />

      {error && (
        <Card>
          <CardContent className="py-4 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-px bg-rule-soft border border-rule-soft dark:bg-rule-on-dark dark:border-rule-on-dark">
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
    <div className="bg-paper dark:bg-card p-6 flex flex-col gap-4 min-h-[180px]">
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

      <div className="border-t border-rule-soft dark:border-rule-on-dark">
        <div className="grid grid-cols-[1fr_auto_auto] gap-x-12 px-1 py-3 border-b border-rule-soft dark:border-rule-on-dark">
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
            className="grid grid-cols-[1fr_auto_auto] gap-x-12 items-baseline px-1 py-5 border-b border-rule-soft dark:border-rule-on-dark"
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
