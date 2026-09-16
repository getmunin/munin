'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@getmunin/ui';
import { useRelative } from '../../lib/use-relative';
import type { ReviewDecidedItem } from './review-decided';
import { decidedOutcomeLabel, decidedTitle } from './review-decided-labels';
import { RowCode } from './queue-panes/shared';
import { queueCodeKey } from './queue-panes/types';
import { QueueRow, RowTime } from './queue-row';

export function ReviewDecidedRow({
  item,
  active,
  onSelect,
}: {
  item: ReviewDecidedItem;
  active: boolean;
  onSelect: () => void;
}) {
  const t = useTranslations('dashboard.console.review');
  const age = useRelative();
  const decidedBy =
    item.decidedBy.actorType === 'user'
      ? (item.decidedBy.name ?? t('decidedByUnknown'))
      : t('decidedByAgent');

  return (
    <QueueRow
      active={active}
      onSelect={onSelect}
      code={<RowCode kind={item.kind}>{t(queueCodeKey(item.kind))}</RowCode>}
      title={decidedTitle(item, t)}
      meta={
        <>
          <span
            className={cn(item.outcome === 'approved' && 'text-ink dark:text-foreground')}
          >
            {decidedOutcomeLabel(item, t)}
          </span>
          {` · ${decidedBy}`}
        </>
      }
      trailing={<RowTime>{age(item.at)}</RowTime>}
    />
  );
}
