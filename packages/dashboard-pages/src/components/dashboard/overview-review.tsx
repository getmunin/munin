'use client';

import { useMemo } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from '../../i18n-navigation';
import { useCountdown } from '../../lib/use-relative';
import { ConsoleListEmpty } from '../console-empty';
import { ConsoleSectionLabel } from '../console-section-label';
import { ReviewGroupRow, ReviewRow } from './review-row';
import { groupReviewQueue } from './review-queue';
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
  const locale = useLocale();
  const countdown = useCountdown();
  const next = scheduled[0];
  const entries = useMemo(() => groupReviewQueue(queue, locale), [queue, locale]);

  return (
    <section className="border-t border-t-ink dark:border-t-rule-on-dark">
      <StatRow
        href="/dashboard/review"
        count={entries.length}
        dot="ring"
        label={t('reviewLabel')}
        note={entries.length > 0 ? t('reviewNoteSome') : t('reviewNoteNone')}
        cta={t('reviewOpen')}
      />
      <ul className="border-t border-rule-soft dark:border-rule-on-dark">
        <ConsoleSectionLabel
          note={entries.length > WAITING_LIMIT ? t('waitingMore', { count: entries.length }) : undefined}
        >
          {t('waiting')}
        </ConsoleSectionLabel>
        {entries.length === 0 ? (
          <ConsoleListEmpty body={t('waitingEmpty')} />
        ) : (
          entries.slice(0, WAITING_LIMIT).map((entry) =>
            entry.type === 'group' ? (
              <ReviewGroupRow
                key={`group-${entry.group.groupId}`}
                group={entry.group}
                active={false}
                onSelect={() => {
                  const first = entry.group.members[0];
                  if (first) router.push(`/dashboard/review/${first.id}`);
                }}
              />
            ) : (
              <ReviewRow
                key={`${entry.item.kind}-${entry.item.id}`}
                item={entry.item}
                active={false}
                onSelect={() => router.push(`/dashboard/review/${entry.item.id}`)}
              />
            ),
          )
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
