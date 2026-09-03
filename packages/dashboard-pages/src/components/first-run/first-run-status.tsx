import type { ReactNode } from 'react';
import { cn } from '@getmunin/ui';

export interface FirstRunStatusRow {
  key: string;
  kind: ReactNode;
  detail: ReactNode;
  meta?: ReactNode;
  live?: boolean;
}

export function FirstRunStatusList({
  rows,
  trailingRule,
}: {
  rows: FirstRunStatusRow[];
  trailingRule?: boolean;
}) {
  return (
    <ul
      className={cn(
        'flex flex-col border-t border-t-ink dark:border-t-rule-on-dark',
        trailingRule && 'border-b border-b-rule-soft dark:border-b-rule-on-dark',
      )}
    >
      {rows.map((row) => (
        <li
          key={row.key}
          className="grid grid-cols-1 gap-1.5 border-b border-rule-soft py-4 last:border-b-0 md:grid-cols-[120px_minmax(0,1fr)_auto] md:items-center md:gap-5 md:py-5 dark:border-rule-on-dark"
        >
          <span className="flex items-center gap-2.5 font-mono text-[9px] uppercase tracking-eyebrow text-ink-mute">
            <StatusDot live={row.live === true} />
            {row.kind}
          </span>
          <span className="text-[15px] text-ink dark:text-foreground [&_span]:text-ink-mute [&_code]:font-mono [&_code]:text-[13.5px] [&_code]:text-ink dark:[&_code]:text-foreground">
            {row.detail}
          </span>
          {row.meta ? (
            <span className="font-mono text-[9px] uppercase tracking-meta text-ink-mute">
              {row.meta}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export interface FirstRunFigure {
  key: string;
  label: ReactNode;
  value: ReactNode;
  muted?: boolean;
}

export function FirstRunFigures({ figures }: { figures: FirstRunFigure[] }) {
  return (
    <dl className="flex flex-col border-t border-ink dark:border-rule-on-dark">
      {figures.map((figure) => (
        <div
          key={figure.key}
          className="flex items-baseline justify-between gap-4 border-b border-rule-soft py-4 last:border-b-0 md:py-5 dark:border-rule-on-dark"
        >
          <dt className="text-[15px] text-ink-soft dark:text-foreground/80">{figure.label}</dt>
          <dd
            className={cn(
              'font-serif text-2xl md:text-[26px]',
              figure.muted ? 'text-ink-mute' : 'text-ink dark:text-foreground',
            )}
          >
            {figure.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function StatusDot({ live }: { live: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'size-[7px] shrink-0 rounded-full',
        live ? 'bg-cobalt dark:bg-cobalt-soft' : 'bg-ink-mute',
      )}
    />
  );
}
