'use client';

import { cn } from '@getmunin/ui';

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn('animate-pulse bg-ink/10 dark:bg-foreground/10', className)}
    />
  );
}

export interface SkeletonColumn {
  grow: number;
  bar: string;
  right?: boolean;
}

export function TableSkeleton({ columns, rows = 4 }: { columns: SkeletonColumn[]; rows?: number }) {
  const cells = (height: string) =>
    columns.map((c, i) => (
      <div
        key={i}
        className={cn('flex min-w-0', c.right && 'justify-end')}
        style={{ flexGrow: c.grow, flexBasis: 0 }}
      >
        <Skeleton className={cn(height, 'max-w-full', c.bar)} />
      </div>
    ));
  return (
    <div role="status" aria-busy="true">
      <span className="sr-only">Loading…</span>
      <div className="flex items-center gap-6 border-b-[1px] border-rule-soft pb-3 dark:border-rule-on-dark">
        {cells('h-2.5')}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div
          key={r}
          className="flex items-center gap-6 border-b-[1px] border-rule-soft py-4 dark:border-rule-on-dark"
        >
          {cells('h-4')}
        </div>
      ))}
    </div>
  );
}

export function CardSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'space-y-3 border-[1px] border-rule-soft p-4 dark:border-rule-on-dark',
        className,
      )}
    >
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-3 w-3/5" />
    </div>
  );
}

export function CardListSkeleton({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <div role="status" aria-busy="true" className={cn('space-y-3', className)}>
      <span className="sr-only">Loading…</span>
      {Array.from({ length: rows }).map((_, i) => (
        <CardSkeleton key={i} />
      ))}
    </div>
  );
}
