'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from '../../i18n-navigation';
import { useCountdown } from '../../lib/use-relative';
import { ConsoleListEmpty } from '../console-empty';
import { ConsoleSectionLabel } from '../console-section-label';
import { ReviewRow } from './review-row';
import { StatRow } from './overview-stat-row';
import type { QueueItem, ScheduledItem } from './queue-panes/types';

const WAITING_LIMIT = 5;

export function OverviewReview({
  queue,
  scheduled,
}: {
  queue: QueueItem[];
  scheduled: ScheduledItem[];
}) {
  const t = useTranslations('dashboard.overview.sections');
  const router = useRouter();
  const countdown = useCountdown();
  const next = scheduled[0];

  return (
    <section className="border-t border-t-ink dark:border-t-rule-on-dark">
      <StatRow
        href="/dashboard/review"
        count={queue.length}
        dot="ring"
        label={t('reviewLabel')}
        note={queue.length > 0 ? t('reviewNoteSome') : t('reviewNoteNone')}
        cta={t('reviewOpen')}
      />
      <ul className="border-t border-rule-soft dark:border-rule-on-dark">
        <ConsoleSectionLabel
          note={queue.length > WAITING_LIMIT ? t('waitingMore', { count: queue.length }) : undefined}
        >
          {t('waiting')}
        </ConsoleSectionLabel>
        {queue.length === 0 ? (
          <ConsoleListEmpty body={t('waitingEmpty')} />
        ) : (
          queue
            .slice(0, WAITING_LIMIT)
            .map((item) => (
              <ReviewRow
                key={`${item.kind}-${item.id}`}
                item={item}
                active={false}
                onSelect={() => router.push(`/dashboard/review/${item.id}`)}
              />
            ))
        )}
      </ul>
      {next ? (
        <button
          type="button"
          onClick={() => router.push(`/dashboard/review/${next.id}`)}
          className="group flex w-full items-baseline justify-between gap-4 px-5 py-3.5 text-left font-mono text-[10px] font-medium uppercase tracking-eyebrow transition-colors duration-fast ease-munin hover:bg-paper-deep dark:hover:bg-secondary"
        >
          <span className="text-ink dark:text-foreground">
            {t('scheduled', { count: scheduled.length })}
          </span>
          <span className="flex shrink-0 items-baseline gap-3 text-ink-mute">
            {t('scheduledNext', { when: countdown(next.at) })}
            <span className="text-cobalt transition-colors duration-fast ease-munin group-hover:text-cobalt-deep dark:text-cobalt-soft">
              →
            </span>
          </span>
        </button>
      ) : null}
    </section>
  );
}
