'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@getmunin/ui';
import { useRelative } from '../../lib/use-relative';
import type { CurationDecisionDto } from './curation-decisions';

export function ReviewDecidedRow({
  item,
  active,
  faded,
  onSelect,
}: {
  item: CurationDecisionDto;
  active: boolean;
  faded?: boolean;
  onSelect: () => void;
}) {
  const t = useTranslations('dashboard.console.review');
  const age = useRelative();
  const published = item.outcome === 'published';

  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        onClick={onSelect}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelect();
          }
        }}
        className={cn(
          'flex cursor-pointer flex-col gap-1 border-b border-rule-soft px-5 py-3.5 transition-[background-color,opacity] duration-fast ease-munin dark:border-rule-on-dark',
          faded && !active && 'opacity-[var(--qfade,0.55)]',
          active
            ? 'border-l-2 border-l-cobalt bg-paper-deep pl-[18px] dark:border-l-cobalt-soft dark:bg-card'
            : 'hover:bg-paper-deep hover:!opacity-100 dark:hover:bg-card',
        )}
      >
        <span className="truncate text-sm text-ink dark:text-foreground">{item.title}</span>
        <span className="flex flex-wrap items-center gap-x-1.5 font-mono text-[10px] uppercase tracking-meta text-ink-mute">
          <span className={cn(published && 'text-ink dark:text-foreground')}>
            {published ? t('outcomePublished') : t('outcomeDismissed')}
          </span>
          <span aria-hidden>·</span>
          <span>
            {item.decidedByActorType === 'user'
              ? (item.decidedByName ?? t('decidedByUnknown'))
              : t('decidedByAgent')}
          </span>
          <span aria-hidden>·</span>
          <span>{age(item.decidedAt)}</span>
        </span>
      </div>
    </li>
  );
}
