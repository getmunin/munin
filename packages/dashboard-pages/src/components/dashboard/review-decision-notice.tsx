'use client';

import type { CSSProperties } from 'react';
import { Check } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@getmunin/ui';
import { PLATFORM_NAMES } from '../integrations/publishing-accounts-grid';
import { MetaArrow } from './meta-arrow';
import type { QueueItem } from './queue-panes/types';
import type { ReviewDecisionOutcome } from './review-queue';

export const NOTICE_MS = 6000;

export interface ReviewDecisionNoticeValue {
  id: string;
  kind: QueueItem['kind'];
  title: string;
  outcome: ReviewDecisionOutcome;
  platform: string | null;
  shownOn: string | null;
}

type Translate = (key: string, values?: Record<string, string>) => string;

export function ReviewDecisionNotice({
  notice,
  onView,
  onExpire,
  className,
}: {
  notice: ReviewDecisionNoticeValue | null;
  onView: (id: string) => void;
  onExpire: () => void;
  className?: string;
}) {
  const t = useTranslations('dashboard.console.review');
  return (
    <div aria-live="polite" className={className}>
      {notice ? (
        <div
          key={notice.id}
          className={cn(
            'group/notice relative flex items-center gap-4 overflow-hidden bg-ink px-5 py-3.5 text-paper md:px-7',
            'animate-notice-in',
            'dark:border-b dark:border-rule-on-dark dark:bg-secondary dark:text-foreground',
          )}
        >
          <Check aria-hidden className="size-4 shrink-0 text-cobalt-soft" />
          <div className="min-w-0 flex-1">
            <div className="truncate font-mono text-[11px] font-medium uppercase tracking-eyebrow text-paper/55 dark:text-foreground/55">
              {eyebrow(notice, t)}
            </div>
            <div className="mt-1 truncate text-[15px] leading-snug">{notice.title}</div>
          </div>
          <button
            type="button"
            onClick={() => onView(notice.id)}
            className="inline-flex shrink-0 items-center gap-1.5 font-mono text-[11px] font-medium uppercase tracking-eyebrow text-cobalt-soft transition-colors duration-fast ease-munin hover:text-paper dark:hover:text-foreground"
          >
            {t('noticeView')}
            <MetaArrow />
          </button>
          <span
            aria-hidden
            onAnimationEnd={onExpire}
            style={{ '--munin-notice-ms': `${NOTICE_MS}ms` } as CSSProperties}
            className="animate-notice-timer absolute inset-x-0 bottom-0 h-[3px] origin-left bg-cobalt-soft group-focus-within/notice:[animation-play-state:paused] group-hover/notice:[animation-play-state:paused]"
          />
        </div>
      ) : null}
    </div>
  );
}

function eyebrow(notice: ReviewDecisionNoticeValue, t: Translate): string {
  if (notice.outcome === 'scheduled') return t('noticeScheduled');
  if (notice.outcome === 'dismissed') {
    const verb = t('noticeDismissed');
    const detail = t(`outcomeDismissed.${notice.kind}`);
    return detail === verb ? verb : `${verb} · ${detail}`;
  }
  const detail =
    notice.kind === 'social' && notice.platform
      ? t('noticePostedTo', { platform: PLATFORM_NAMES[notice.platform] ?? notice.platform })
      : t(`outcomeApproved.${notice.kind}`);
  return `${t('noticeApproved')} · ${detail}`;
}
