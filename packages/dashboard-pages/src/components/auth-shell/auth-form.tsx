'use client';

import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
import { forwardRef } from 'react';
import { cn } from '@getmunin/ui';

export function AuthField({ children }: { children: ReactNode }) {
  return <div className="mb-[18px] flex flex-col gap-2">{children}</div>;
}

export function AuthLabel({
  htmlFor,
  children,
}: {
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <label htmlFor={htmlFor} className="text-[13px] font-medium text-ink">
      {children}
    </label>
  );
}

interface AuthInputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const AuthInput = forwardRef<HTMLInputElement, AuthInputProps>(
  function AuthInput({ className, invalid, ...props }, ref) {
    return (
      <input
        ref={ref}
        {...props}
        className={cn(
          'border-[0.5px] bg-paper px-4 py-3.5 text-[15px] text-ink',
          'placeholder:text-ink-mute',
          'transition-colors duration-fast ease-munin',
          'focus:outline-none focus:ring-[3px] focus:ring-ink/[0.08]',
          invalid
            ? 'border-alert-bad-border-[0.5px] focus:border-alert-bad-border-[0.5px]'
            : 'border-rule-soft focus:border-ink',
          className,
        )}
      />
    );
  },
);

interface AuthSubmitProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'navy' | 'ghost';
}

export const AuthSubmit = forwardRef<HTMLButtonElement, AuthSubmitProps>(
  function AuthSubmit({ className, variant = 'navy', children, ...props }, ref) {
    return (
      <button
        ref={ref}
        {...props}
        className={cn(
          'mt-2 inline-flex w-full items-center justify-center gap-2 border-[0.5px] px-[18px] py-4 text-[15px] font-medium',
          'transition-colors duration-fast ease-munin active:translate-y-px',
          'disabled:cursor-not-allowed disabled:opacity-60',
          variant === 'navy'
            ? 'border-ink bg-ink text-paper hover:border-cobalt-deep hover:bg-cobalt-deep'
            : 'border-ink bg-transparent text-ink hover:bg-ink hover:text-paper',
          className,
        )}
      >
        {children}
      </button>
    );
  },
);

export function AuthFieldHint({
  tone = 'default',
  children,
}: {
  tone?: 'default' | 'bad';
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        'font-mono text-[11px] tracking-wide',
        tone === 'bad' ? 'text-alert-bad-ink' : 'text-ink-mute',
      )}
    >
      {children}
    </span>
  );
}

export function AuthOAuthButton({
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        'inline-flex w-full items-center justify-center gap-3.5 border-[0.5px] border-rule-soft bg-paper px-[18px] py-4 text-[15px] text-ink',
        'transition-colors duration-fast ease-munin hover:border-ink active:translate-y-px',
        className,
      )}
    >
      {children}
    </button>
  );
}
