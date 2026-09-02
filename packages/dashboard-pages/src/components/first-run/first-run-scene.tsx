import type { ReactNode } from 'react';
import { cn } from '@getmunin/ui';

export function FirstRunScene({
  eyebrow,
  title,
  lede,
  children,
}: {
  eyebrow: ReactNode;
  title: ReactNode;
  lede?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="mx-auto flex w-full max-w-[780px] flex-col gap-9 px-5 pb-16 pt-12 md:gap-11 md:px-11 md:pb-20 md:pt-16">
      <header className="flex flex-col gap-4">
        <span className="font-mono text-[11px] uppercase tracking-eyebrow text-cobalt dark:text-cobalt-soft">
          {eyebrow}
        </span>
        <h1 className="font-serif text-[38px] font-normal leading-[1.05] tracking-tight text-ink md:text-[52px] dark:text-foreground [&_em]:italic [&_em]:text-cobalt dark:[&_em]:text-cobalt-soft">
          {title}
        </h1>
        {lede ? (
          <p className="max-w-[54ch] text-[15px] leading-relaxed text-ink-soft md:text-base dark:text-foreground/80">
            {lede}
          </p>
        ) : null}
      </header>
      {children}
    </section>
  );
}

export function FirstRunActions({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2.5">{children}</div>;
}

export function FirstRunAside({
  label,
  meta,
  children,
}: {
  label: ReactNode;
  meta?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 border-t border-ink pt-6 dark:border-rule-on-dark">
      <div className="flex items-baseline gap-4 font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute">
        <span>{label}</span>
        {meta ? <span className="ml-auto tracking-meta">{meta}</span> : null}
      </div>
      <p className="max-w-[60ch] text-[14.5px] leading-relaxed text-ink-soft dark:text-foreground/80">
        {children}
      </p>
    </div>
  );
}

export function FirstRunNote({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <p
      className={cn(
        'border-t border-ink pt-6 font-serif text-xl italic leading-snug text-ink-soft md:text-[23px] dark:border-rule-on-dark dark:text-foreground/80',
        className,
      )}
    >
      {children}
    </p>
  );
}

export function FirstRunPassage({ children }: { children: ReactNode }) {
  return (
    <p className="max-w-[54ch] text-[15px] leading-relaxed text-ink-soft md:text-base dark:text-foreground/80">
      {children}
    </p>
  );
}

export function FirstRunFootnote({ children }: { children: ReactNode }) {
  return (
    <p className="max-w-[54ch] border-t border-rule-soft pt-6 text-sm leading-relaxed text-ink-mute dark:border-rule-on-dark">
      {children}
    </p>
  );
}
