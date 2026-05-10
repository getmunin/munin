'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { cn, Eyebrow, Pill } from '@getmunin/ui';
import {
  formatRelativeAge,
  type InboxPreviewKind,
  type InboxPreviewRow,
} from '../../lib/inbox-preview';

const PILL_TONE: Record<InboxPreviewKind, 'live' | 'kb' | 'crm' | 'out'> = {
  conv: 'live',
  kb: 'kb',
  crm: 'crm',
  out: 'out',
};

interface InboxPreviewProps {
  rows: InboxPreviewRow[];
  totalCount: number;
}

export function InboxPreview({ rows, totalCount }: InboxPreviewProps) {
  return (
    <section className="min-w-0">
      <div className="flex items-baseline justify-between gap-4 border-b border-ink pb-2.5 mb-3.5 dark:border-foreground">
        <Eyebrow tone="ink" size="sm" className="font-medium">
          Inbox{' '}
          <span className="text-cobalt dark:text-cobalt-soft ml-1.5">
            {String(totalCount).padStart(2, '0')}
          </span>
        </Eyebrow>
        <Link
          href="/dashboard/inbox"
          className="font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute hover:text-cobalt transition-colors duration-fast"
        >
          Open inbox →
        </Link>
      </div>

      {rows.length === 0 ? (
        <p className="font-serif italic text-base text-ink-mute py-6">
          Nothing waiting — the perch is quiet.
        </p>
      ) : (
        <ul className="list-none m-0 p-0">
          {rows.map((row) => (
            <InboxRow key={row.id} row={row} />
          ))}
        </ul>
      )}

      <Link
        href="/dashboard/inbox"
        className="mt-3.5 inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-eyebrow text-cobalt hover:text-cobalt-deep transition-colors duration-fast py-2 dark:text-cobalt-soft"
      >
        Open inbox →
      </Link>
    </section>
  );
}

function InboxRow({ row }: { row: InboxPreviewRow }) {
  const age = useRelativeAge(row.timestamp);
  return (
    <li>
      <Link
        href="/dashboard/inbox"
        className={cn(
          'grid items-center gap-3.5 px-1.5 py-2.5 border-b border-rule-soft cursor-pointer transition-[padding,background] duration-fast ease-munin hover:bg-paper-deep hover:pl-3 dark:border-rule-on-dark dark:hover:bg-secondary',
          'grid-cols-[120px_minmax(0,1fr)_auto]',
        )}
      >
        <span className="flex">
          <Pill tone={PILL_TONE[row.kind]} pulse={row.live}>
            {row.pillLabel}
          </Pill>
        </span>
        <span className="min-w-0 truncate text-[13px] block">
          <span
            className={cn(
              'font-medium',
              row.live ? 'text-cobalt dark:text-cobalt-soft' : 'text-ink dark:text-foreground',
            )}
          >
            {row.subject}
          </span>
          <span className="text-ink-mute ml-2">· {row.who}</span>
        </span>
        <span
          className={cn(
            'font-mono text-[10px] text-right min-w-[48px]',
            row.live ? 'text-cobalt dark:text-cobalt-soft' : 'text-ink-mute',
          )}
        >
          {age}
        </span>
      </Link>
    </li>
  );
}

function useRelativeAge(iso: string): string {
  const [age, setAge] = useState(() => formatRelativeAge(iso));
  useEffect(() => {
    setAge(formatRelativeAge(iso));
    const id = setInterval(() => setAge(formatRelativeAge(iso)), 60_000);
    return () => clearInterval(id);
  }, [iso]);
  return age;
}
