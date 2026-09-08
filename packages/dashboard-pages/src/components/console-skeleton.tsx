'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@getmunin/ui';
import { Skeleton } from './skeleton';

export function ConsoleRowsSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <li
          key={i}
          aria-hidden
          className="grid grid-cols-[52px_minmax(0,1fr)_auto] items-start gap-3.5 border-b border-rule-soft px-5 py-3.5 dark:border-rule-on-dark"
        >
          <Skeleton className="h-4 w-11 justify-self-start" />
          <span className="flex min-w-0 flex-col gap-1.5">
            <Skeleton className={cn('h-3.5', i % 3 === 1 ? 'w-4/5' : 'w-3/5')} />
            <Skeleton className={cn('h-3', i % 2 === 0 ? 'w-2/5' : 'w-3/5')} />
          </span>
          <Skeleton className="h-2.5 w-7" />
        </li>
      ))}
    </>
  );
}

export function ConsoleSplitSkeleton({ grid, lede }: { grid: string; lede?: boolean }) {
  const t = useTranslations('common');

  return (
    <div role="status" aria-busy="true" className={cn('grid h-full min-h-0 grid-cols-1', grid)}>
      <span className="sr-only">{t('loading')}</span>
      <section className="flex min-h-0 flex-col border-r border-ink dark:border-rule-on-dark">
        <header className="shrink-0 space-y-3 border-b border-rule-soft px-5 pb-4 pt-6 dark:border-rule-on-dark">
          <Skeleton className="h-2.5 w-36" />
          <Skeleton className="h-7 w-4/5" />
          {lede ? <Skeleton className="h-3 w-3/5" /> : <Skeleton className="h-8 w-full" />}
        </header>
        <ul className="min-h-0 flex-1 overflow-hidden">
          <ConsoleRowsSkeleton />
        </ul>
      </section>
      <div className="hidden bg-paper-deep md:block dark:bg-secondary" />
    </div>
  );
}

export function ConsoleTableSkeleton({ grid, rows = 5 }: { grid: string; rows?: number }) {
  const t = useTranslations('common');

  return (
    <div role="status" aria-busy="true">
      <span className="sr-only">{t('loading')}</span>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          aria-hidden
          className={cn(grid, 'border-b border-rule-soft py-4 dark:border-rule-on-dark')}
        >
          <Skeleton className="h-3.5 w-2/3" />
          <Skeleton className="h-3 w-20 max-md:hidden" />
          <Skeleton className="h-5 w-14 max-md:mt-2.5" />
          <Skeleton className="h-7 w-40 max-md:mt-2.5 md:justify-self-end" />
        </div>
      ))}
    </div>
  );
}

export function ConsoleHeroSkeleton({ actions }: { actions?: boolean }) {
  return (
    <header
      aria-hidden
      className="flex flex-col justify-between gap-6 px-5 pb-5 pt-8 md:flex-row md:items-end md:px-8"
    >
      <div className="min-w-0 flex-1 space-y-2.5">
        <Skeleton className="h-2.5 w-40" />
        <Skeleton className="h-9 w-2/3" />
        <Skeleton className="h-3 w-1/2" />
      </div>
      {actions ? <Skeleton className="h-14 w-28 shrink-0 md:h-16" /> : null}
    </header>
  );
}
