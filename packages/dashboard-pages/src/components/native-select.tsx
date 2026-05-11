'use client';

import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@getmunin/ui';
import { nativeFieldClass } from './page-shell';

interface NativeSelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  wrapperClassName?: string;
}

export const NativeSelect = React.forwardRef<HTMLSelectElement, NativeSelectProps>(
  function NativeSelect({ className, wrapperClassName, children, ...props }, ref) {
    return (
      <div className={cn('relative', wrapperClassName)}>
        <select
          ref={ref}
          className={cn(
            nativeFieldClass,
            'appearance-none pr-9 cursor-pointer focus-visible:ring-0',
            className,
          )}
          {...props}
        >
          {children}
        </select>
        <ChevronDown
          aria-hidden
          className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-ink-mute"
        />
      </div>
    );
  },
);
