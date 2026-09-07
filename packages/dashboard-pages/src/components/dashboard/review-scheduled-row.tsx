'use client';

import { useTranslations } from 'next-intl';
import { useCountdown } from '../../lib/use-relative';
import { RowCode } from './queue-panes/shared';
import { QueueRow, RowTime } from './queue-row';
import { queueCodeKey, type ScheduledItem } from './queue-panes/types';

export function ReviewScheduledRow({
  item,
  active,
  onSelect,
}: {
  item: ScheduledItem;
  active: boolean;
  onSelect: () => void;
}) {
  const t = useTranslations('dashboard.console.review');
  const countdown = useCountdown();

  return (
    <QueueRow
      active={active}
      onSelect={onSelect}
      code={<RowCode kind={item.kind}>{t(queueCodeKey(item.kind))}</RowCode>}
      title={item.title}
      meta={item.snippet}
      trailing={<RowTime tone="cobalt">{countdown(item.at)}</RowTime>}
    />
  );
}
