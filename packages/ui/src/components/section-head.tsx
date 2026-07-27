import * as React from 'react';

import { cn } from '../cn';

interface SectionHeadProps extends Omit<React.ComponentProps<'div'>, 'title'> {
  title: React.ReactNode;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  divider?: boolean;
}

function SectionHead({
  title,
  meta,
  actions,
  divider = true,
  className,
  ...props
}: SectionHeadProps) {
  return (
    <div
      data-slot="section-head"
      className={cn(
        'flex items-end justify-between gap-4 pb-3',
        divider && 'border-b-[1px] border-rule-soft dark:border-rule-on-dark',
        className,
      )}
      {...props}
    >
      <div className="min-w-0 space-y-1">
        <h2 className="font-serif text-xl md:text-2xl leading-tight font-normal tracking-tight text-ink dark:text-foreground [&_em]:italic [&_em]:text-cobalt dark:[&_em]:text-cobalt-soft">
          {title}
        </h2>
        {meta ? (
          <p className="font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute">
            {meta}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export { SectionHead };
