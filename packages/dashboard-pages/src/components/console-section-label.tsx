import type { ReactNode } from 'react';

export function ConsoleSectionLabel({ children }: { children: ReactNode }) {
  return (
    <li className="border-b border-rule-soft px-5 py-3 font-mono text-[9px] uppercase tracking-eyebrow text-ink-mute dark:border-rule-on-dark">
      {children}
    </li>
  );
}
