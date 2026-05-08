import * as React from 'react';

import { cn } from '../cn';
import { Eyebrow } from './eyebrow';

interface HeroProps extends Omit<React.ComponentProps<'header'>, 'title'> {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  lede?: React.ReactNode;
  actions?: React.ReactNode;
}

function Hero({ eyebrow, title, lede, actions, className, ...props }: HeroProps) {
  return (
    <header
      data-slot="hero"
      className={cn('flex items-end justify-between gap-8 pb-8', className)}
      {...props}
    >
      <div className="min-w-0 max-w-3xl space-y-3">
        {eyebrow ? <Eyebrow tone="muted">{eyebrow}</Eyebrow> : null}
        <h1 className="font-serif text-4xl md:text-5xl leading-[1.05] font-normal tracking-tight text-ink dark:text-foreground [&_em]:italic [&_em]:text-cobalt dark:[&_em]:text-cobalt-soft">
          {title}
        </h1>
        {lede ? (
          <p className="text-base leading-[1.5] text-ink-soft max-w-xl dark:text-foreground/80">
            {lede}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export { Hero };
