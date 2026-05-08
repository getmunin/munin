import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '../cn';

const eyebrowVariants = cva(
  'font-mono uppercase tracking-eyebrow leading-none',
  {
    variants: {
      tone: {
        accent: 'text-cobalt dark:text-cobalt-soft',
        muted: 'text-ink-mute',
        ink: 'text-ink dark:text-foreground',
      },
      size: {
        default: 'text-[11px]',
        sm: 'text-[10px]',
        lg: 'text-xs',
      },
    },
    defaultVariants: { tone: 'muted', size: 'default' },
  },
);

interface EyebrowProps
  extends React.ComponentProps<'span'>,
    VariantProps<typeof eyebrowVariants> {}

function Eyebrow({ className, tone, size, ...props }: EyebrowProps) {
  return (
    <span
      data-slot="eyebrow"
      className={cn(eyebrowVariants({ tone, size }), className)}
      {...props}
    />
  );
}

export { Eyebrow, eyebrowVariants };
