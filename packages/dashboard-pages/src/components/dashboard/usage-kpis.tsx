'use client';

import { Link } from '../../i18n-navigation';
import { useTranslations } from 'next-intl';
import { Eyebrow } from '@getmunin/ui';
import { Spark } from './spark';

interface SummaryTile {
  current: number;
  previous: number;
  sparkline: number[];
}

export interface UsageSummary {
  mcpCalls: SummaryTile;
  apiCalls: SummaryTile;
  aiTokens: SummaryTile;
  conversations: SummaryTile;
  avgLatencyMs: SummaryTile;
}

interface UsageKpisProps {
  summary: UsageSummary | null;
}

export function UsageKpis({ summary }: UsageKpisProps) {
  const t = useTranslations('dashboard.usage.tiles');

  return (
    <section className="min-w-0">
      <div className="flex items-baseline justify-between gap-4 border-b-[1px] border-rule-soft pb-2.5 mb-3.5 dark:border-rule-on-dark">
        <Eyebrow tone="ink" size="sm" className="font-medium">
          {t('headline')}
        </Eyebrow>
        <Link
          href="/dashboard/settings/usage"
          className="font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute hover:text-cobalt transition-colors duration-fast"
        >
          {t('byAgentBreakdown')}
        </Link>
      </div>

      <div className="grid gap-3.5 grid-cols-[repeat(auto-fit,minmax(180px,1fr))]">
        <Kpi
          label={t('mcpCalls')}
          value={summary?.mcpCalls.current}
          previous={summary?.mcpCalls.previous}
          spark={summary?.mcpCalls.sparkline ?? []}
          format={formatCount}
        />
        <Kpi
          label={t('apiCalls')}
          value={summary?.apiCalls.current}
          previous={summary?.apiCalls.previous}
          spark={summary?.apiCalls.sparkline ?? []}
          format={formatCount}
        />
        <Kpi
          label={t('aiTokens')}
          value={summary?.aiTokens.current}
          previous={summary?.aiTokens.previous}
          spark={summary?.aiTokens.sparkline ?? []}
          format={formatCount}
        />
        <Kpi
          label={t('conversations')}
          value={summary?.conversations.current}
          previous={summary?.conversations.previous}
          spark={summary?.conversations.sparkline ?? []}
          format={formatCount}
        />
        <Kpi
          label={t('avgLatency7d')}
          value={summary?.avgLatencyMs.current}
          previous={summary?.avgLatencyMs.previous}
          spark={summary?.avgLatencyMs.sparkline ?? []}
          format={formatLatency}
          lowerIsBetter
          tone="ink"
        />
      </div>
    </section>
  );
}

interface KpiProps {
  label: string;
  value: number | undefined;
  previous: number | undefined;
  spark: number[];
  format: (n: number) => string;
  lowerIsBetter?: boolean;
  tone?: 'accent' | 'ink';
}

function Kpi({ label, value, previous, spark, format, lowerIsBetter, tone = 'accent' }: KpiProps) {
  const t = useTranslations('dashboard.usage.tiles');
  const delta = formatDelta(value, previous, format, lowerIsBetter, t);
  return (
    <div className="border-[1px] border-rule-soft bg-paper px-4 py-3.5 dark:bg-card dark:border-rule-on-dark">
      <div className="font-mono text-[9px] uppercase tracking-eyebrow text-ink-mute">{label}</div>
      <div className="font-serif text-[28px] leading-none tracking-tight my-1.5 text-ink dark:text-foreground">
        {value === undefined ? '—' : format(value)}
      </div>
      <div
        className={
          delta?.tone === 'positive'
            ? 'font-mono text-[10px] text-emerald-700 dark:text-emerald-400'
            : 'font-mono text-[10px] text-ink-mute'
        }
      >
        {delta?.label ?? ' '}
      </div>
      <Spark className="mt-2" values={spark} tone={tone} />
    </div>
  );
}

function formatCount(n: number): string {
  return n.toLocaleString();
}

function formatLatency(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms)}ms`;
}

function formatDelta(
  current: number | undefined,
  previous: number | undefined,
  format: (n: number) => string,
  lowerIsBetter: boolean | undefined,
  t: ReturnType<typeof useTranslations>,
): { tone: 'positive' | 'neutral'; label: string } | null {
  if (current === undefined || previous === undefined || previous === 0) return null;
  const diff = current - previous;
  if (diff === 0) return { tone: 'neutral', label: t('deltaFlat') };
  const pct = Math.round((Math.abs(diff) / previous) * 100);
  const isImprovement = lowerIsBetter ? diff < 0 : diff > 0;
  if (lowerIsBetter) {
    const absDiff = Math.abs(diff);
    const key = diff > 0 ? 'deltaUp' : 'deltaDown';
    return {
      tone: isImprovement ? 'positive' : 'neutral',
      label: t(key, { value: format(absDiff) }),
    };
  }
  const key = diff > 0 ? 'deltaPctUp' : 'deltaPctDown';
  return {
    tone: isImprovement ? 'positive' : 'neutral',
    label: t(key, { pct }),
  };
}
