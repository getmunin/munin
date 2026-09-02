import type { ReactNode } from 'react';

export function ConsoleSectionLabel({
  note,
  children,
}: {
  note?: ReactNode;
  children: ReactNode;
}) {
  return (
    <li className="flex items-baseline justify-between gap-4 border-b border-rule-soft px-5 py-3 font-mono text-[9px] uppercase tracking-eyebrow text-ink-mute dark:border-rule-on-dark">
      <span>{children}</span>
      {note ? <span className="shrink-0 text-right">{note}</span> : null}
    </li>
  );
}
