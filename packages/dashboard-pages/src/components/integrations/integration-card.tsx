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
    <div className="flex items-end justify-between gap-4 border-b-[1px] border-rule-soft pb-3 dark:border-rule-on-dark">
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

export function IntegrationCard({
  vendor,
  name,
  instance,
  meta,
  description,
  footer,
  menu,
}: {
  vendor: string;
  name: string;
  instance?: string;
  meta?: ReactNode;
  description: string;
  footer: ReactNode;
  menu?: ReactNode;
}) {
  const showInstance = instance !== undefined && instance !== '' && instance !== name;
  return (
    <div className="flex flex-col gap-3 border-[1px] border-rule-soft bg-paper p-5 dark:border-rule-on-dark dark:bg-card">
      <div className="flex items-center gap-3">
        <VendorIcon vendor={vendor} label={name} />
        <div className="flex min-w-0 flex-col gap-1">
          <span className="truncate text-sm font-medium text-ink dark:text-foreground">
            {name}
            {showInstance ? <span className="text-ink-mute"> · {instance}</span> : null}
          </span>
          {meta}
        </div>
        {menu ? <div className="ml-auto flex-none self-start">{menu}</div> : null}
      </div>
      <p className="flex-1 text-[13px] leading-snug text-ink-mute">{description}</p>
      <div className="flex flex-wrap items-center gap-2">{footer}</div>
    </div>
  );
}
