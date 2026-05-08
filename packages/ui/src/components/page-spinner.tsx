import { Loader2 } from 'lucide-react';

import { cn } from '../cn';

interface PageSpinnerProps {
  label?: string;
  className?: string;
}

export function PageSpinner({ label = 'Loading…', className }: PageSpinnerProps) {
  return (
    <div
      role="status"
      aria-busy="true"
      className={cn('flex min-h-[60vh] items-center justify-center', className)}
    >
      <Loader2
        className="size-6 animate-spin text-ink-mute dark:text-foreground/60"
        aria-label={label}
      />
      <span className="sr-only">{label}</span>
    </div>
  );
}
