'use client';

import type { ReactNode } from 'react';
import { cn } from '@getmunin/ui';
import { Skeleton } from '../skeleton';

const SKELETON_WIDTHS = ['w-[92%]', 'w-[76%]', 'w-[48%]'];

export const AGENT_TINT_CLASS =
  'border-transparent bg-agent-tint dark:border-transparent dark:bg-agent-tint-on-dark';

export function DraftSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-[9px]">
      {SKELETON_WIDTHS.map((width, i) => (
        <Skeleton
          key={width}
          className={cn('h-[7px] bg-ink-mute/60 dark:bg-foreground/30', width)}
          style={{ animationDelay: `${i * 300}ms` }}
        />
      ))}
    </div>
  );
}

export function AgentDraftLabel({
  label,
  aside,
  busy,
}: {
  label: string;
  aside?: ReactNode;
  busy?: boolean;
}) {
  return (
    <div
      role="status"
      aria-busy={busy || undefined}
      className="flex min-w-0 shrink-0 items-baseline gap-2.5 font-mono text-[10px] font-medium uppercase tracking-meta text-ink-soft dark:text-foreground/70"
    >
      <span className="min-w-0 truncate">{label}</span>
      {aside}
    </div>
  );
}

export function AgentDraftAction({
  onClick,
  expanded,
  ariaLabel,
  disabled,
  children,
}: {
  onClick: () => void;
  expanded?: boolean;
  ariaLabel?: string;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <>
      <span aria-hidden className="text-ink-mute">
        ·
      </span>
      <button
        type="button"
        aria-expanded={expanded}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={onClick}
        className="shrink-0 uppercase text-ink underline underline-offset-[3px] transition-colors duration-fast hover:text-cobalt disabled:pointer-events-none disabled:opacity-50 dark:text-foreground dark:hover:text-cobalt-soft"
      >
        {children}
      </button>
    </>
  );
}

export function AgentDraftSlab({
  label,
  aside,
  busy,
  className,
  children,
}: {
  label: string;
  aside?: ReactNode;
  busy?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-2.5 rounded-input px-3.5 py-3 text-ink dark:text-foreground',
        AGENT_TINT_CLASS,
        className,
      )}
    >
      <AgentDraftLabel label={label} aside={aside} busy={busy} />
      {children}
    </div>
  );
}
