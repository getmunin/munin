'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@getmunin/ui';
import { useRelative } from '../../lib/use-relative';
import { RowCode } from './queue-panes/shared';
import { QueueRow, RowTime } from './queue-row';
import { queueCodeKey, type QueueItem } from './queue-panes/types';
import type { ReviewGroup } from './review-queue';

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

export function ReviewGroupRow({
  group,
  active,
  onSelect,
}: {
  group: ReviewGroup;
  active: boolean;
  onSelect: () => void;
}) {
  const t = useTranslations('dashboard.console.review');
  const age = useRelative();
  const first = group.members[0];

  return (
    <QueueRow
      active={active}
      onSelect={onSelect}
      code={<RowCode kind="cms">{t(queueCodeKey('cms'))}</RowCode>}
      title={group.lead.title}
      meta={
        <span className="flex items-center gap-1.5">
          <span className="truncate">{first?.raw.collectionName}</span>
          <span
            className="flex shrink-0 items-center gap-1"
            aria-label={t('groupLanguages', {
              waiting: group.members.length,
              total: group.translations.length,
            })}
          >
            {group.translations.map((tr) => (
              <span
                key={tr.id}
                aria-hidden
                className={cn(
                  'border-[1px] px-1 font-mono text-[10px] uppercase leading-[1.5] tracking-meta',
                  tr.status === 'published'
                    ? 'border-verdigris bg-verdigris-tint text-verdigris dark:border-verdigris-soft dark:bg-transparent dark:text-verdigris-soft'
                    : tr.status === 'scheduled'
                      ? 'border-cobalt text-cobalt dark:border-cobalt-soft dark:text-cobalt-soft'
                      : tr.status === 'archived'
                        ? 'border-rule-soft text-ink-mute line-through dark:border-rule-on-dark'
                        : 'border-ink/40 text-ink dark:border-foreground/40 dark:text-foreground',
                )}
              >
                {tr.locale}
              </span>
            ))}
          </span>
        </span>
      }
      trailing={first ? <RowTime>{age(first.createdAt)}</RowTime> : null}
    />
  );
}
