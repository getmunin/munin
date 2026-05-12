import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '../cn';

const pillVariants = cva(
  "inline-flex items-center gap-1.5 px-1.5 py-[3px] font-mono text-[9px] uppercase tracking-eyebrow font-medium border-[0.5px] whitespace-nowrap before:content-[''] before:size-[5px] before:rounded-full before:bg-current",
  {
    variants: {
      tone: {
        live: 'border-current text-cobalt dark:text-cobalt-soft',
        draft: 'border-current text-ink-mute',
        ink: 'border-current text-ink dark:text-foreground',
        conv: 'border-current text-ink dark:text-foreground',
        kb: 'border-current text-ink dark:text-foreground',
        crm: 'border-current text-ink dark:text-foreground',
        out: 'border-current text-ink dark:text-foreground',
        review: 'border-current text-cobalt dark:text-cobalt-soft',
      },
      pulse: {
        true: 'before:animate-pulse',
        false: '',
      },
    },
    defaultVariants: { tone: 'ink', pulse: false },
  },
);

interface PillProps
  extends React.ComponentProps<'span'>,
    VariantProps<typeof pillVariants> {}

function Pill({ className, tone, pulse, ...props }: PillProps) {
  return (
    <span
      data-slot="pill"
      className={cn(pillVariants({ tone, pulse }), className)}
      {...props}
    />
  );
}

export { Pill, pillVariants };
