'use client';

import type { ReactNode } from 'react';
import { VendorIcon } from './vendor-catalog';

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
        <span className="text-[13px] text-ink-mute">{subtitle}</span>
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

export function IntegrationCard({
  vendor,
  name,
  instance,
  meta,
  description,
  footer,
}: {
  vendor: string;
  name: string;
  instance?: string;
  meta?: ReactNode;
  description: string;
  footer: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 border-[0.5px] border-rule-soft bg-paper p-5 dark:border-rule-on-dark dark:bg-card">
      <div className="flex items-center gap-3">
        <VendorIcon vendor={vendor} label={name} />
        <div className="flex min-w-0 flex-col gap-1">
          <span className="truncate text-sm font-medium text-ink dark:text-foreground">
            {name}
            {instance ? <span className="text-ink-mute"> · {instance}</span> : null}
          </span>
          {meta}
        </div>
      </div>
      <p className="flex-1 text-[13px] leading-snug text-ink-mute">{description}</p>
      <div className="flex flex-wrap items-center gap-2">{footer}</div>
    </div>
  );
}

export function StatusLine({
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
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap text-[11px] ${color}`}>
      <span className="size-[5px] rounded-full bg-current" />
      {label}
    </span>
  );
}
