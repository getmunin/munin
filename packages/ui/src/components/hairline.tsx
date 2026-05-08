import * as React from 'react';

import { cn } from '../cn';

interface HairlineProps extends React.ComponentProps<'hr'> {
  variant?: 'soft' | 'hard';
}

function Hairline({ variant = 'soft', className, ...props }: HairlineProps) {
  return (
    <hr
      data-slot="hairline"
      className={cn(
        'border-0 border-t',
        variant === 'hard'
          ? 'border-ink dark:border-foreground'
          : 'border-rule-soft dark:border-rule-on-dark',
        className,
      )}
      {...props}
    />
  );
}

export { Hairline };
