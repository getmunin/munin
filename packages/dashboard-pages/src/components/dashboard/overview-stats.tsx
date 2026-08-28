'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@getmunin/ui';
import { Link } from '../../i18n-navigation';

function StatRow({
  href,
  count,
  dot,
  label,
  note,
  cta,
  bordered,
}: {
  href: string;
  count: number;
  dot: 'live' | 'ring';
  label: string;
  note: string;
  cta: string;
  bordered?: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        'group flex w-full items-center gap-3.5 px-1 py-4 text-left md:gap-5 md:py-5',
        bordered && 'border-t border-rule-soft dark:border-rule-on-dark',
      )}
    >
      {dot === 'live' && count > 0 ? (
        <span aria-hidden className="relative size-2 shrink-0">
          <span className="absolute inset-0 animate-ping rounded-full bg-cobalt opacity-60 [animation-duration:2s] dark:bg-cobalt-soft" />
          <span className="absolute inset-0 rounded-full bg-cobalt shadow-[0_0_0_4px_rgba(0,102,255,0.22)] dark:bg-cobalt-soft" />
        </span>
      ) : (
        <span
          aria-hidden
          className={cn(
            'shrink-0 rounded-full',
            dot === 'live'
              ? 'size-2 bg-ink-mute'
              : cn(
                  'size-[9px] border-[1.5px] bg-transparent',
                  count > 0 ? 'border-cobalt dark:border-cobalt-soft' : 'border-ink-mute',
                ),
          )}
        />
      )}
      <span className="min-w-[40px] font-serif text-[32px] leading-none text-ink md:min-w-[52px] md:text-[44px] dark:text-foreground">
        {count}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5 md:gap-1">
        <span className="truncate font-mono text-[9px] uppercase tracking-eyebrow text-ink-mute md:text-[10px]">
          {label}
        </span>
        <span className="text-[13.5px] text-ink md:text-[15px] dark:text-foreground">{note}</span>
      </span>
      <span className="ml-auto shrink-0 text-cobalt transition-colors duration-fast ease-munin group-hover:text-cobalt-deep dark:text-cobalt-soft">
        <span className="hidden whitespace-nowrap font-mono text-[10px] uppercase tracking-eyebrow md:inline">
          {cta}
        </span>
        <span aria-hidden className="font-mono text-base leading-none md:hidden">
          →
        </span>
      </span>
    </Link>
  );
}

export function OverviewStats({
  liveCount,
  learningCount,
}: {
  liveCount: number;
  learningCount: number;
}) {
  const t = useTranslations('dashboard.overview.stats');
  return (
    <section className="border-b border-rule-soft border-t border-t-ink dark:border-b-rule-on-dark dark:border-t-rule-on-dark">
      <StatRow
        href="/dashboard/conversations"
        count={liveCount}
        dot="live"
        label={t('liveLabel')}
        note={liveCount > 0 ? t('liveNoteSome') : t('liveNoteNone')}
        cta={t('liveOpen')}
      />
      <StatRow
        href="/dashboard/learning"
        count={learningCount}
        dot="ring"
        label={t('learnLabel')}
        note={learningCount > 0 ? t('learnNoteSome') : t('learnNoteNone')}
        cta={t('learnOpen')}
        bordered
      />
    </section>
  );
}
