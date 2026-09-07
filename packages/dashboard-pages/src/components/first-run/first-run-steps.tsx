import type { ReactNode } from 'react';
import { cn } from '@getmunin/ui';

export interface FirstRunStep {
  key: string;
  title: ReactNode;
  body: ReactNode;
  actions?: ReactNode;
  tag?: ReactNode;
  done?: boolean;
}

export function FirstRunSteps({ steps }: { steps: FirstRunStep[] }) {
  return (
    <ol className="flex flex-col border-t border-ink dark:border-rule-on-dark">
      {steps.map((step, index) => (
        <li
          key={step.key}
          className="grid grid-cols-[52px_minmax(0,1fr)] gap-5 border-b border-rule-soft py-7 last:border-b-0 md:grid-cols-[76px_minmax(0,1fr)] md:gap-[22px] md:py-8 dark:border-rule-on-dark"
        >
          <StepNumber
            value={index + 1}
            accent={!step.done}
            className="text-[34px] md:text-[44px]"
          />
          <div className="flex min-w-0 flex-col gap-3.5">
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <h2 className="font-serif text-2xl font-normal leading-tight text-ink md:text-[29px] dark:text-foreground">
                {step.title}
              </h2>
              {step.tag ? (
                <span
                  className={cn(
                    'font-mono text-[9px] uppercase tracking-eyebrow',
                    step.done ? 'text-cobalt dark:text-cobalt-soft' : 'text-ink-mute',
                  )}
                >
                  {step.tag}
                </span>
              ) : null}
            </div>
            <p className="max-w-[56ch] text-[15px] leading-relaxed text-ink-soft dark:text-foreground/80 [&_code]:font-mono [&_code]:text-[13px]">
              {step.body}
            </p>
            {step.actions ? (
              <div className="mt-0.5 flex flex-wrap items-center gap-2.5">{step.actions}</div>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

export interface FirstRunChainStep {
  key: string;
  title: ReactNode;
  note: ReactNode;
  tag: ReactNode;
  done?: boolean;
}

export function FirstRunChain({ steps }: { steps: FirstRunChainStep[] }) {
  return (
    <ol className="flex flex-col border-t border-ink dark:border-rule-on-dark">
      {steps.map((step, index) => (
        <li
          key={step.key}
          className="grid grid-cols-[52px_minmax(0,1fr)] items-baseline gap-4 border-b border-rule-soft py-5 last:border-b-0 md:grid-cols-[76px_minmax(0,1fr)_auto] md:gap-5 md:py-6 dark:border-rule-on-dark"
        >
          <StepNumber
            value={index + 1}
            accent={step.done === true}
            className="text-[26px] md:text-[34px]"
          />
          <div className="flex min-w-0 flex-col gap-1.5">
            <span className="text-[15px] text-ink md:text-base dark:text-foreground">
              {step.title}
            </span>
            <span className="text-sm leading-relaxed text-ink-soft dark:text-foreground/80">
              {step.note}
            </span>
            <span
              className={cn(
                'mt-1 font-mono text-[9px] uppercase tracking-eyebrow md:hidden',
                step.done ? 'text-cobalt dark:text-cobalt-soft' : 'text-ink-mute',
              )}
            >
              {step.tag}
            </span>
          </div>
          <span
            className={cn(
              'hidden font-mono text-[9px] uppercase tracking-eyebrow md:inline',
              step.done ? 'text-cobalt dark:text-cobalt-soft' : 'text-ink-mute',
            )}
          >
            {step.tag}
          </span>
        </li>
      ))}
    </ol>
  );
}

function StepNumber({
  value,
  accent = true,
  className,
}: {
  value: number;
  accent?: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'font-serif italic leading-[0.9]',
        accent ? 'text-cobalt dark:text-cobalt-soft' : 'text-ink-mute',
        className,
      )}
    >
      {String(value).padStart(2, '0')}
    </span>
  );
}
