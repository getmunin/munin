'use client';

import Image from 'next/image';
import { Link } from '../../i18n-navigation';
import type { ReactNode } from 'react';
import { cn } from '@getmunin/ui';

interface AuthShellProps {
  leftZone: ReactNode;
  rightZone: ReactNode;
  variant?: 'form' | 'invite';
}

export function AuthShell({ leftZone, rightZone, variant = 'form' }: AuthShellProps) {
  return (
    <div className="relative grid min-h-screen grid-cols-1 md:grid-cols-2">
      <div className="pointer-events-none absolute inset-y-0 left-1/2 hidden w-px bg-rule-soft md:block" />

      <Link
        href="/"
        className="absolute left-14 top-9 z-10 inline-flex items-center gap-3 text-ink"
        aria-label="Munin home"
      >
        <Image
          src="/munin-logo.png"
          alt=""
          width={30}
          height={30}
          className="block"
          priority
        />
        <span className="font-serif text-[26px] tracking-[-0.01em]">Munin</span>
      </Link>

      <section
        className={cn(
          'relative flex bg-paper',
          variant === 'form'
            ? 'items-center justify-center px-8 py-32 md:px-14'
            : 'items-center justify-center px-8 py-32 md:px-14',
        )}
      >
        {variant === 'form' ? (
          <div className="w-full max-w-[420px]">{leftZone}</div>
        ) : (
          <div className="w-full max-w-[520px]">{leftZone}</div>
        )}
      </section>

      {rightZone}
    </div>
  );
}

export function AuthHeading({ children }: { children: ReactNode }) {
  return (
    <h1 className="m-0 mb-[18px] font-serif text-[56px] font-normal leading-none tracking-[-0.02em] text-ink">
      {children}
    </h1>
  );
}

export function AuthSubheading({ children }: { children: ReactNode }) {
  return <p className="m-0 mb-10 text-[15px] text-ink-soft">{children}</p>;
}

export function AuthFootnote({ children }: { children: ReactNode }) {
  return <p className="mt-[22px] text-sm text-ink-soft">{children}</p>;
}

export function AuthDivider({ label }: { label: string }) {
  return (
    <div className="my-7 grid grid-cols-[1fr_auto_1fr] items-center gap-[14px] text-[13px] text-ink-mute">
      <span className="h-px bg-rule-soft" />
      <span>{label}</span>
      <span className="h-px bg-rule-soft" />
    </div>
  );
}
