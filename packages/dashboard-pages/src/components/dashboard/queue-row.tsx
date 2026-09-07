'use client';

import type { ReactNode } from 'react';
import { cn } from '@getmunin/ui';

export function QueueRow({
  code,
  title,
  emphasizeTitle,
  meta,
  extra,
  trailing,
  active,
  faded,
  onSelect,
}: {
  code?: ReactNode;
  title: ReactNode;
  emphasizeTitle?: boolean;
  meta?: ReactNode;
  extra?: ReactNode;
  trailing?: ReactNode;
  active: boolean;
  faded?: boolean;
  onSelect: () => void;
}) {
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
          'grid cursor-pointer grid-cols-[52px_minmax(0,1fr)_auto] items-start gap-3.5 border-b border-rule-soft px-5 py-3.5 transition-[background-color,opacity] duration-fast ease-munin dark:border-rule-on-dark',
          faded && !active && 'opacity-[var(--qfade,0.55)]',
          active
            ? 'border-l-2 border-l-cobalt bg-paper-deep pl-[18px] dark:border-l-cobalt-soft dark:bg-card'
            : 'hover:bg-paper-deep hover:!opacity-100 dark:hover:bg-card',
        )}
      >
        <span className="flex self-center justify-self-start">{code}</span>
        <span className="flex min-w-0 flex-col gap-0.5">
          <span
            className={cn(
              'truncate text-sm text-ink dark:text-foreground',
              emphasizeTitle && 'font-medium',
            )}
          >
            {title}
          </span>
          {meta ? (
            <span className="truncate text-[13px] text-ink-mute dark:text-foreground/50">
              {meta}
            </span>
          ) : null}
          {extra}
        </span>
        <span className="flex min-w-[56px] flex-col items-end gap-1.5">{trailing}</span>
      </div>
    </li>
  );
}

export function RowTime({
  children,
  tone = 'mute',
}: {
  children: ReactNode;
  tone?: 'mute' | 'cobalt';
}) {
  return (
    <span
      className={cn(
        'whitespace-nowrap font-mono text-[10px]',
        tone === 'cobalt' ? 'text-cobalt dark:text-cobalt-soft' : 'text-ink-mute',
      )}
    >
      {children}
    </span>
  );
}

export function RowNote({ children }: { children: ReactNode }) {
  return (
    <span className="truncate font-mono text-[9px] uppercase tracking-meta text-ink-mute">
      {children}
    </span>
  );
}
