import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@getmunin/ui';

interface ConsoleHeroProps extends Omit<ComponentProps<'header'>, 'title'> {
  eyebrow?: ReactNode;
  title: ReactNode;
  lede?: ReactNode;
  actions?: ReactNode;
}

export function ConsoleHero({
  eyebrow,
  title,
  lede,
  actions,
  className,
  ...props
}: ConsoleHeroProps) {
  return (
    <header
      data-slot="console-hero"
      className={cn(
        'flex flex-col justify-between gap-6 px-5 pb-5 pt-8 md:flex-row md:items-end md:px-8',
        className,
      )}
      {...props}
    >
      <div className="min-w-0 space-y-2.5">
        {eyebrow ? (
          <div className="font-mono text-[11px] uppercase tracking-eyebrow text-cobalt dark:text-cobalt-soft">
            {eyebrow}
          </div>
        ) : null}
        <h1 className="font-serif text-4xl font-normal leading-[1.05] tracking-tight text-ink dark:text-foreground [&_em]:italic [&_em]:text-cobalt dark:[&_em]:text-cobalt-soft">
          {title}
        </h1>
        {lede ? (
          <p className="max-w-[52ch] text-sm leading-relaxed text-ink-soft dark:text-foreground/80">
            {lede}
          </p>
        ) : null}
      </div>
      {actions ? <div className="shrink-0 md:text-right">{actions}</div> : null}
    </header>
  );
}
