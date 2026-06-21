'use client';

import { useState, type MouseEvent, type ReactNode } from 'react';

export function DocsSide({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);

  const closeOnLink = (e: MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('a')) setOpen(false);
  };

  return (
    <nav className="docs-side" data-open={open} aria-label="Section navigation">
      <button
        type="button"
        className="docs-side-toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span>{label}</span>
        <span className="chev" aria-hidden>
          ▾
        </span>
      </button>
      <div className="docs-side-list" onClick={closeOnLink}>
        {children}
      </div>
    </nav>
  );
}
