'use client';

import { Check } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@getmunin/ui';
import type { QueueItem } from './queue-panes/types';
import type { ReviewDecisionOutcome } from './review-queue';

export interface ReviewDecisionNoticeValue {
  id: string;
  kind: QueueItem['kind'];
  title: string;
  outcome: ReviewDecisionOutcome;
  shownOn: string | null;
}

export function ReviewDecisionNotice({
  notice,
  onView,
  className,
}: {
  notice: ReviewDecisionNoticeValue | null;
  onView: (id: string) => void;
  className?: string;
}) {
  const t = useTranslations('dashboard.console.review');
  return (
    <div aria-live="polite" className={className}>
      {notice ? (
        <div
          className={cn(
            'flex items-center gap-3 border-b border-rule-soft bg-paper-deep px-5 py-2.5 text-[13px] md:px-7',
            'dark:border-rule-on-dark dark:bg-secondary',
          )}
        >
          <Check aria-hidden className="size-4 shrink-0 text-cobalt dark:text-cobalt-soft" />
          <span className="min-w-0 truncate text-ink dark:text-foreground">
            <span className="font-medium">{outcomeVerb(notice, t)}</span>
            <span className="text-ink-mute"> · </span>
            {notice.title}
          </span>
          <button
            type="button"
            onClick={() => onView(notice.id)}
            className="ml-auto shrink-0 font-mono text-[11px] font-medium uppercase tracking-eyebrow text-cobalt hover:text-cobalt-deep dark:text-cobalt-soft"
          >
            {t('noticeView')}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function outcomeVerb(notice: ReviewDecisionNoticeValue, t: (key: string) => string): string {
  if (notice.outcome === 'scheduled') return t('noticeScheduled');
  const key = notice.outcome === 'approved' ? 'outcomeApproved' : 'outcomeDismissed';
  return t(`${key}.${notice.kind}`);
}
