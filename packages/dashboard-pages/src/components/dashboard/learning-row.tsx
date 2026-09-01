'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@getmunin/ui';
import { useRelative } from '../../lib/use-relative';
import { DEFAULT_CURATION_TARGET_SPACE } from './inbox-data';
import type { QueueItem } from './queue-drawers/types';

export type KbQueueItem = QueueItem & { kind: 'kb' };

export function LearningRow({
  item,
  active,
  onSelect,
}: {
  item: KbQueueItem;
  active: boolean;
  onSelect: () => void;
}) {
  const t = useTranslations('dashboard.console.learning');
  const age = useRelative();
  const isRevision = !!item.raw.revisesDocumentId;
  const space = item.raw.proposedTargetSpaceSlug ?? DEFAULT_CURATION_TARGET_SPACE;

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
          'flex cursor-pointer flex-col gap-1 border-b border-rule-soft px-5 py-3.5 transition-colors duration-fast ease-munin dark:border-rule-on-dark',
          active
            ? 'border-l-2 border-l-cobalt bg-paper-deep pl-[18px] dark:border-l-cobalt-soft dark:bg-card'
            : 'hover:bg-paper-deep dark:hover:bg-card',
        )}
      >
        <span className="font-mono text-[9.5px] uppercase tracking-eyebrow text-cobalt dark:text-cobalt-soft">
          {isRevision
            ? t('kindRevisionOf', { title: item.raw.revisesDocumentTitle ?? item.title })
            : t('kindNew')}
        </span>
        <span className="truncate text-sm text-ink dark:text-foreground">{item.title}</span>
        <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-meta text-ink-mute">
          <span>{space}</span>
          <span aria-hidden>·</span>
          <span>{age(item.createdAt)}</span>
        </span>
      </div>
    </li>
  );
}
