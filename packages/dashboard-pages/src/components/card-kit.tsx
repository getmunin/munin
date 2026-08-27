'use client';

import type { ReactNode } from 'react';
import { MoreHorizontal } from 'lucide-react';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  cn,
} from '@getmunin/ui';

export function CardGrid({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
  );
}

export function CardMenu({
  label,
  disabled,
  children,
}: {
  label: string;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="icon-sm" aria-label={label} disabled={disabled} />
        }
      >
        <MoreHorizontal className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">{children}</DropdownMenuContent>
    </DropdownMenu>
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

export function SettingsCard({
  kind,
  menu,
  name,
  qualifier,
  status,
  accent,
  children,
  footerAction,
  footerMeta,
}: {
  kind: string;
  menu?: ReactNode;
  name: string;
  qualifier?: string;
  status: ReactNode;
  accent?: 'pending' | 'error';
  children?: ReactNode;
  footerAction?: ReactNode;
  footerMeta?: ReactNode;
}) {
  return (
    <div
      className={cn(
        'flex flex-col border-[1px] border-rule-soft bg-paper p-4 dark:border-rule-on-dark dark:bg-card',
        accent === 'pending' && 'border-t-[1.5px] border-t-amber-500 dark:border-t-amber-400',
        accent === 'error' && 'border-t-[1.5px] border-t-destructive',
      )}
    >
      <div className="flex items-center gap-2">
        <span className="truncate font-mono text-[9px] uppercase tracking-eyebrow text-ink-mute">
          {kind}
        </span>
        <div className="ml-auto flex flex-none items-center gap-1.5">
          {status}
          {menu}
        </div>
      </div>
      <div className="mt-1.5">
        <span className="block max-w-full truncate text-[15px] font-medium text-ink dark:text-foreground">
          {name}
          {qualifier ? (
            <span className="font-mono text-[13px] tracking-tight text-ink-mute"> · {qualifier}</span>
          ) : null}
        </span>
      </div>
      {children ? <div className="mt-2.5 flex-1">{children}</div> : <div className="flex-1" />}
      {footerAction || footerMeta ? (
        <div className="mt-3 flex flex-wrap items-center gap-2.5 border-t-[1px] border-rule-soft pt-3 dark:border-rule-on-dark">
          {footerMeta ? (
            <span className="min-w-0 truncate font-mono text-[9px] uppercase tracking-eyebrow text-ink-mute">
              {footerMeta}
            </span>
          ) : null}
          {footerAction ? (
            <div className="ml-auto flex flex-none items-center gap-2">{footerAction}</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
