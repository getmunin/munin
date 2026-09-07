'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@getmunin/ui';
import { useRelative } from '../../lib/use-relative';
import { DEFAULT_CURATION_TARGET_SPACE } from './inbox-data';
import { RowCode } from './queue-drawers/shared';
import { queueCodeKey, type QueueItem } from './queue-drawers/types';

function useMetaLine() {
  const t = useTranslations('dashboard.console.review');

  return (item: QueueItem): string => {
    switch (item.kind) {
      case 'kb': {
        if (item.raw.revisesDocumentId) {
          return t('metaKbRevision', {
            title: item.raw.revisesDocumentTitle ?? item.title,
          });
        }
        return t('metaKbNew', {
          space: item.raw.proposedTargetSpaceSlug ?? DEFAULT_CURATION_TARGET_SPACE,
        });
      }
      case 'cms':
        return item.raw.wordCount != null
          ? t('metaCms', {
              collection: item.raw.collectionName,
              wordCount: item.raw.wordCount,
            })
          : t('metaCmsNoBody', { collection: item.raw.collectionName });
      case 'crm':
        return t('metaCrm', { confidence: item.raw.confidence });
      case 'outreach':
        return (
          item.raw.delivery?.destination ??
          item.raw.contact?.email ??
          item.raw.campaign?.name ??
          t('metaOutreachUnknown')
        );
      case 'feedback':
        return t('metaFeedback', { scope: item.raw.appScope ?? t('metaFeedbackScopeFallback') });
    }
  };
}

export function ReviewRow({
  item,
  active,
  onSelect,
}: {
  item: QueueItem;
  active: boolean;
  onSelect: () => void;
}) {
  const t = useTranslations('dashboard.console.review');
  const age = useRelative();
  const metaLine = useMetaLine();

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
          'flex cursor-pointer items-start gap-3.5 border-b border-rule-soft px-5 py-3.5 transition-colors duration-fast ease-munin dark:border-rule-on-dark',
          active
            ? 'border-l-2 border-l-cobalt bg-paper-deep pl-[18px] dark:border-l-cobalt-soft dark:bg-card'
            : 'hover:bg-paper-deep dark:hover:bg-card',
        )}
      >
        <RowCode kind={item.kind} className="pt-[3px]">
          {t(queueCodeKey(item.kind))}
        </RowCode>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-[15px] leading-snug text-ink dark:text-foreground">
            {item.title}
          </span>
          <span className="truncate text-[13px] leading-snug text-ink-mute">
            {metaLine(item)}
          </span>
        </span>
        <span className="shrink-0 pt-[3px] font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute">
          {age(item.createdAt)}
        </span>
      </div>
    </li>
  );
}
