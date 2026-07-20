'use client';

import type { ReactNode } from 'react';
import { VendorIcon } from './vendor-catalog';

/** Section header: serif title + mono subtitle + right-aligned "N connected" count over a hairline. */
export function SectionHeading({
  title,
  subtitle,
  countLabel,
}: {
  title: string;
  subtitle: string;
  countLabel?: string;
}) {
  return (
    <div className="flex items-end justify-between gap-4 border-b-[0.5px] border-rule-soft pb-3 dark:border-rule-on-dark">
      <div className="flex flex-col gap-1">
        <h2 className="font-serif text-xl leading-none text-ink dark:text-foreground">{title}</h2>
        <span className="font-serif text-sm italic text-ink-mute">{subtitle}</span>
      </div>
      {countLabel ? (
        <span className="font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute">
          {countLabel}
        </span>
      ) : null}
    </div>
  );
}

export function CardGrid({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
  );
}

/**
 * One App Store-style vendor card: icon tile + name (+ optional instance) +
 * mono category badge + description, with a caller-supplied footer (Connect,
 * or a status pill + manage actions).
 */
export function IntegrationCard({
  vendor,
  name,
  instance,
  category,
  description,
  footer,
}: {
  vendor: string;
  name: string;
  instance?: string;
  category: string;
  description: string;
  footer: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 border-[0.5px] border-rule-soft bg-paper p-5 dark:border-rule-on-dark dark:bg-card">
      <div className="flex items-center gap-3">
        <VendorIcon vendor={vendor} label={name} />
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-sm font-medium text-ink dark:text-foreground">
            {name}
            {instance ? <span className="text-ink-mute"> · {instance}</span> : null}
          </span>
          <span className="font-serif text-[13px] italic leading-none text-ink-mute">
            {category}
          </span>
        </div>
      </div>
      <p className="flex-1 font-serif text-[15px] leading-snug text-ink-mute">{description}</p>
      <div className="flex flex-wrap items-center justify-between gap-2">{footer}</div>
    </div>
  );
}

/** Status pill (dot + label) matching the comp's inset-border pill. */
export function StatusPill({
  label,
  tone = 'active',
}: {
  label: string;
  tone?: 'active' | 'pending' | 'error' | 'inactive';
}) {
  const color =
    tone === 'error'
      ? 'text-destructive'
      : tone === 'pending'
        ? 'text-amber-600 dark:text-amber-400'
        : tone === 'inactive'
          ? 'text-ink-mute'
          : 'text-cobalt';
  return (
    <span
      className={`inline-flex flex-none items-center gap-1.5 whitespace-nowrap px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-eyebrow shadow-[inset_0_0_0_0.5px_currentColor] ${color}`}
    >
      <span className="size-[5px] rounded-full bg-current" />
      {label}
    </span>
  );
}
