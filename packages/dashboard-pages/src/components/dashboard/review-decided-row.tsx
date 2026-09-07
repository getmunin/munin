'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@getmunin/ui';
import { useRelative } from '../../lib/use-relative';
import type { CurationDecisionDto } from './curation-decisions';
import { RowCode } from './queue-panes/shared';
import { QueueRow, RowTime } from './queue-row';

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
  const decidedBy =
    item.decidedByActorType === 'user'
      ? (item.decidedByName ?? t('decidedByUnknown'))
      : t('decidedByAgent');

  return (
    <QueueRow
      active={active}
      faded={faded}
      onSelect={onSelect}
      code={<RowCode kind="kb">{t('codeKb')}</RowCode>}
      title={item.title}
      meta={
        <>
          <span className={cn(published && 'text-ink dark:text-foreground')}>
            {published ? t('outcomePublished') : t('outcomeDismissed')}
          </span>
          {` · ${decidedBy}`}
        </>
      }
      trailing={<RowTime>{age(item.decidedAt)}</RowTime>}
    />
  );
}
