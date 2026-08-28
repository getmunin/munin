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
        'group flex w-full items-center gap-5 px-1 py-5 text-left',
        bordered && 'border-t border-rule-soft dark:border-rule-on-dark',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'shrink-0 rounded-full',
          dot === 'live'
            ? cn(
                'size-2',
                count > 0
                  ? 'bg-cobalt shadow-[0_0_0_4px_rgba(0,102,255,0.22)] dark:bg-cobalt-soft'
                  : 'bg-ink-mute',
              )
            : cn(
                'size-[9px] border-[1.5px] bg-transparent',
                count > 0 ? 'border-cobalt dark:border-cobalt-soft' : 'border-ink-mute',
              ),
        )}
      />
      <span className="min-w-[52px] font-serif text-[44px] leading-none text-ink dark:text-foreground">
        {count}
      </span>
      <span className="flex min-w-0 flex-col gap-1">
        <span className="font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute">
          {label}
        </span>
        <span className="text-[15px] text-ink dark:text-foreground">{note}</span>
      </span>
      <span className="ml-auto whitespace-nowrap font-mono text-[10px] uppercase tracking-eyebrow text-cobalt transition-colors duration-fast ease-munin group-hover:text-cobalt-deep dark:text-cobalt-soft">
        {cta}
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
