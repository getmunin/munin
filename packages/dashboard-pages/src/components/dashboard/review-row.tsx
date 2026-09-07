'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@getmunin/ui';
import { useRelative } from '../../lib/use-relative';
import { DEFAULT_CURATION_TARGET_SPACE } from './inbox-data';
import { RowCode } from './queue-panes/shared';
import { queueCodeKey, type QueueItem } from './queue-panes/types';

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
          'grid cursor-pointer grid-cols-[52px_minmax(0,1fr)_auto] items-start gap-3.5 border-b border-rule-soft px-5 py-3.5 transition-colors duration-fast ease-munin dark:border-rule-on-dark',
          active
            ? 'border-l-2 border-l-cobalt bg-paper-deep pl-[18px] dark:border-l-cobalt-soft dark:bg-card'
            : 'hover:bg-paper-deep dark:hover:bg-card',
        )}
      >
        <RowCode kind={item.kind} className="w-auto self-center justify-self-start">
          {t(queueCodeKey(item.kind))}
        </RowCode>
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-sm text-ink dark:text-foreground">{item.title}</span>
          <span className="truncate text-[13px] text-ink-soft dark:text-foreground/70">
            {metaLine(item)}
          </span>
        </span>
        <span className="flex min-w-[56px] flex-col items-end">
          <span className="font-mono text-[10px] text-ink-mute">{age(item.createdAt)}</span>
        </span>
      </div>
    </li>
  );
}
