'use client';

import type { ReactNode } from 'react';
import { Button, cn } from '@getmunin/ui';

export interface LoadFailedDetail {
  endpoint: string;
  status: string;
  requestId?: string | null;
  lastSeen?: string | null;
}

export interface LoadFailedProps {
  size: 'inbox' | 'settings';
  eyebrow: string;
  heading: ReactNode;
  lede: ReactNode;
  detail: LoadFailedDetail;
  onRetry: () => void;
  retryLabel: string;
  retryingLabel: string;
  autoRetryHint?: string;
  retrying?: boolean;
  screenLabel?: string;
  className?: string;
}

export function LoadFailed({
  size,
  eyebrow,
  heading,
  lede,
  detail,
  onRetry,
  retryLabel,
  retryingLabel,
  autoRetryHint,
  retrying = false,
  screenLabel,
  className,
}: LoadFailedProps) {
  const isInbox = size === 'inbox';
  const detailRows: { k: string; v: string }[] = [];
  if (detail.requestId) detailRows.push({ k: 'request_id', v: detail.requestId });
  detailRows.push({ k: 'endpoint', v: detail.endpoint });
  detailRows.push({ k: 'status', v: detail.status });
  if (detail.lastSeen) detailRows.push({ k: 'last_seen', v: detail.lastSeen });

  return (
    <section
      data-slot="load-failed"
      data-screen-label={screenLabel}
      className={cn(
        'flex flex-col text-ink dark:text-foreground',
        isInbox ? 'gap-8 py-16' : 'gap-6',
        className,
      )}
    >
      <div className="space-y-3">
        <div className="flex items-center gap-2 font-mono uppercase tracking-eyebrow text-[11px] text-alert-bad-ink">
          <span
            aria-hidden
            className="size-1.5 animate-pulse rounded-full bg-alert-bad-border"
          />
          <span>{eyebrow}</span>
        </div>

        <h1
          className={cn(
            'font-serif font-normal text-ink dark:text-foreground leading-[1.05] tracking-tight',
            '[&_em]:italic [&_em]:text-alert-bad-ink',
            isInbox ? 'text-[56px]' : 'text-4xl md:text-5xl',
          )}
        >
          {heading}
        </h1>

        <p className="text-base leading-[1.5] text-ink-soft max-w-xl dark:text-foreground/80">
          {lede}
        </p>
      </div>

      <dl
        className={cn(
          'grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5 border-[0.5px] border-rule-soft dark:border-rule-on-dark bg-paper-deep dark:bg-secondary p-4',
          isInbox ? 'max-w-[520px]' : 'max-w-[480px]',
        )}
      >
        {detailRows.map(({ k, v }) => (
          <div key={k} className="contents">
            <dt className="font-mono text-[11px] text-ink-mute dark:text-foreground/60 pt-0.5">
              {k}
            </dt>
            <dd className="font-mono text-[12px] text-ink dark:text-foreground break-words">
              {v}
            </dd>
          </div>
        ))}
      </dl>

      <div className="flex items-center gap-3">
        <Button variant="default" onClick={onRetry} disabled={retrying}>
          {retrying ? retryingLabel : retryLabel}
        </Button>
        {autoRetryHint && (
          <span className="font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute dark:text-foreground/60">
            {autoRetryHint}
          </span>
        )}
      </div>
    </section>
  );
}
