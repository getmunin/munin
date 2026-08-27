'use client';

import { ArrowRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@getmunin/ui';
import { Link } from '../../i18n-navigation';

interface StatRowProps {
  count: number;
  label: string;
  note: string;
  href?: string;
  linkLabel: string;
  live?: boolean;
  divided?: boolean;
}

export interface OverviewStatsProps {
  liveCount: number;
  learningCount: number;
  liveHref?: string;
  learningHref?: string;
}

export function OverviewStats({
  liveCount,
  learningCount,
  liveHref,
  learningHref,
}: OverviewStatsProps) {
  const t = useTranslations('dashboard.overview.stats');

  return (
    <section className="border-y-[1px] border-rule-soft dark:border-rule-on-dark">
      <StatRow
        count={liveCount}
        label={t('liveLabel')}
        note={t('liveNote')}
        href={liveHref}
        linkLabel={t('openConversations')}
        live
      />
      <StatRow
        count={learningCount}
        label={t('learningLabel')}
        note={t('learningNote')}
        href={learningHref}
        linkLabel={t('openLearning')}
        divided
      />
    </section>
  );
}

function StatRow({ count, label, note, href, linkLabel, live, divided }: StatRowProps) {
  const rowClass = cn(
    'flex items-center gap-3.5 px-1 py-3.5',
    divided && 'border-t-[1px] border-rule-soft dark:border-rule-on-dark',
    href && 'transition-colors duration-fast ease-munin hover:bg-paper-deep dark:hover:bg-secondary',
  );

  const body = (
    <>
      <span
        aria-hidden
        className={cn(
          'shrink-0 rounded-full',
          live
            ? 'size-2 bg-cobalt shadow-[0_0_0_3px_rgb(var(--munin-accent)/0.22)] dark:bg-cobalt-soft'
            : 'size-[9px] border-[1.5px] border-ink dark:border-foreground',
        )}
      />
      <span className="shrink-0 font-serif text-[32px] leading-none text-ink dark:text-foreground">
        {count}
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="font-mono text-[9px] uppercase tracking-meta text-ink-mute dark:text-foreground/55">
          {label}
        </span>
        <span className="truncate text-[13.5px] text-ink dark:text-foreground">{note}</span>
      </span>
      {href ? (
        <ArrowRight
          aria-hidden
          className="ml-auto size-4 shrink-0 text-cobalt dark:text-cobalt-soft"
        />
      ) : null}
    </>
  );

  if (!href) return <div className={rowClass}>{body}</div>;

  return (
    <Link href={href} aria-label={linkLabel} className={rowClass}>
      {body}
    </Link>
  );
}
