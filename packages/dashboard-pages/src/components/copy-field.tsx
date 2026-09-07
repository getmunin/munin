'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@getmunin/ui';
import { useCopy } from '../lib/use-copy';

export interface CopyFieldProps {
  value: string;
  resetMs?: number;
  placeholder?: ReactNode;
  className?: string;
}

export function CopyField({ value, resetMs, placeholder, className }: CopyFieldProps) {
  const t = useTranslations('common');
  const { copied, copy } = useCopy(resetMs);
  const empty = value.length === 0;

  return (
    <div
      className={cn(
        'flex w-full items-stretch border border-ink bg-paper-deep dark:border-rule-on-dark dark:bg-secondary',
        empty && 'border-dashed',
        className,
      )}
    >
      <code
        className={cn(
          'min-w-0 flex-1 truncate px-3.5 py-2.5 font-mono text-[13px]',
          empty ? 'text-ink-mute' : 'text-ink dark:text-foreground',
        )}
      >
        {empty ? placeholder : value}
      </code>
      {empty ? null : (
        <button
          type="button"
          onClick={() => copy(value)}
          className={cn(
            'shrink-0 border-l border-ink px-3.5 font-mono text-[9px] uppercase tracking-eyebrow transition-colors duration-fast ease-munin dark:border-rule-on-dark',
            copied
              ? 'text-cobalt dark:text-cobalt-soft'
              : 'text-ink-soft hover:text-ink dark:text-foreground/70 dark:hover:text-foreground',
          )}
        >
          <span className="grid">
            <span className={cn('col-start-1 row-start-1', copied && 'invisible')}>
              {t('copy')}
            </span>
            <span className={cn('col-start-1 row-start-1', !copied && 'invisible')}>
              {t('copied')}
            </span>
          </span>
        </button>
      )}
    </div>
  );
}
