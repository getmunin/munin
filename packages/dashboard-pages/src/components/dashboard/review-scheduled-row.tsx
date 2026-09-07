'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@getmunin/ui';
import { useCountdown } from '../../lib/use-relative';
import { RowCode } from './queue-panes/shared';
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
        <RowCode kind={item.kind} className="self-center">
          {t(queueCodeKey(item.kind))}
        </RowCode>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-[15px] leading-snug text-ink dark:text-foreground">
            {item.title}
          </span>
          <span className="truncate text-[13px] leading-snug text-ink-mute">{item.snippet}</span>
        </span>
        <span className="shrink-0 self-center font-mono text-[10px] uppercase tracking-eyebrow text-cobalt dark:text-cobalt-soft">
          {countdown(item.at)}
        </span>
      </div>
    </li>
  );
}
