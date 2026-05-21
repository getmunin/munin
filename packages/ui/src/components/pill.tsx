import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '../cn';

const pillVariants = cva(
  "inline-flex items-center gap-1.5 px-1.5 py-[3px] font-mono text-[9px] uppercase tracking-eyebrow font-medium shadow-[inset_0_0_0_0.5px_currentColor] whitespace-nowrap before:content-[''] before:size-[5px] before:rounded-full before:bg-current",
  {
    variants: {
      tone: {
        live: 'text-cobalt dark:text-cobalt-soft',
        draft: 'text-ink-mute',
        ink: 'text-ink dark:text-foreground',
        conv: 'text-ink dark:text-foreground',
        kb: 'text-ink dark:text-foreground',
        crm: 'text-ink dark:text-foreground',
        out: 'text-ink dark:text-foreground',
        review: 'text-cobalt dark:text-cobalt-soft',
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
