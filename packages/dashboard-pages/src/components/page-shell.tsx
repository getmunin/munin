import * as React from 'react';

import { cn, Hero } from '@getmunin/ui';

interface PageShellProps {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  lede?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export function PageShell({ eyebrow, title, lede, actions, children, className }: PageShellProps) {
  return (
    <div className={cn('space-y-10', className)}>
      <Hero eyebrow={eyebrow} title={title} lede={lede} actions={actions} />
      <div className="space-y-10">{children}</div>
    </div>
  );
}

export const nativeFieldClass =
  'h-9 w-full min-w-0 rounded-input border-[1px] border-rule-soft bg-paper px-3 py-1.5 text-sm text-ink transition-colors duration-fast ease-munin outline-none focus-visible:border-cobalt focus-visible:ring-1 focus-visible:ring-cobalt disabled:opacity-50 dark:bg-card dark:text-foreground dark:border-rule-on-dark';
