'use client';

import { useCopy } from '../../lib/use-copy';

export function SetupStep({
  index,
  title,
  children,
}: {
  index: string;
  title: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex gap-4 border-t-[1px] border-rule-soft py-4 first:border-t-0 first:pt-0 dark:border-rule-on-dark">
      <span className="flex-none pt-[1px] font-serif text-lg italic leading-none text-cobalt dark:text-cobalt-soft">
        {index}
      </span>
      <div className="min-w-0 flex-1 space-y-2">
        <p className="text-sm font-medium text-ink dark:text-foreground">{title}</p>
        {children}
      </div>
    </div>
  );
}

export function DialogEyebrow({ left, right }: { left: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute">
      <span>{left}</span>
      {right}
    </div>
  );
}

export function CopyField({
  value,
  copyLabel,
  copiedLabel,
}: {
  value: string;
  copyLabel: string;
  copiedLabel: string;
}) {
  const { copy, copied } = useCopy();
  return (
    <div className="flex items-stretch border-[1px] border-rule-soft bg-paper-deep dark:border-rule-on-dark dark:bg-secondary">
      <span className="min-w-0 flex-1 break-all px-3 py-2 font-mono text-xs text-ink dark:text-foreground">
        {value}
      </span>
      <button
        type="button"
        onClick={() => copy(value)}
        className="flex-none border-l-[1px] border-rule-soft px-3 font-mono text-[10px] uppercase tracking-eyebrow text-cobalt dark:border-rule-on-dark dark:text-cobalt-soft"
      >
        {copied ? copiedLabel : copyLabel}
      </button>
    </div>
  );
}

export function PortalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="text-cobalt underline underline-offset-2 dark:text-cobalt-soft"
    >
      {children}
    </a>
  );
}
