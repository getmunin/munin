'use client';

import { useTranslations } from 'next-intl';
import { useRelative } from '../../lib/use-relative';
import { RowCode } from './queue-panes/shared';
import { QueueRow, RowTime } from './queue-row';
import { queueCodeKey, type QueueItem } from './queue-panes/types';

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

  return (
    <QueueRow
      active={active}
      onSelect={onSelect}
      code={<RowCode kind={item.kind}>{t(queueCodeKey(item.kind))}</RowCode>}
      title={item.title}
      meta={item.snippet}
      trailing={<RowTime>{age(item.createdAt)}</RowTime>}
    />
  );
}
