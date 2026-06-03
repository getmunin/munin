'use client';

import { useEffect } from 'react';
import { Button, Pill, cn } from '@getmunin/ui';
import ReactMarkdown, { type Components } from 'react-markdown';

export type DrawerPillTone =
  | 'live'
  | 'ink'
  | 'draft'
  | 'kb'
  | 'crm'
  | 'out'
  | 'cms'
  | 'feedback'
  | 'review';

export const MD_COMPONENTS: Components = {
  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="mb-2 list-disc space-y-1 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="mb-2 list-decimal space-y-1 pl-5">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  strong: ({ children }) => (
    <strong className="font-semibold text-ink dark:text-foreground">{children}</strong>
  ),
  em: ({ children }) => <em className="italic">{children}</em>,
  h1: ({ children }) => <p className="mb-2 font-serif text-base font-medium">{children}</p>,
  h2: ({ children }) => <p className="mb-2 font-serif text-base font-medium">{children}</p>,
  h3: ({ children }) => <p className="mb-2 font-serif text-base font-medium">{children}</p>,
  code: ({ children }) => (
    <code className="font-mono text-xs bg-paper-deep px-1 py-0.5 dark:bg-secondary">
      {children}
    </code>
  ),
  a: ({ href, children }) => (
    <a
      href={href}
      className="text-cobalt underline-offset-2 hover:underline dark:text-cobalt-soft"
    >
      {children}
    </a>
  ),
};

export function useCmdEnter(handler: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        handler();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handler]);
}

export function DrawerHeader({
  pillTone,
  pillLabel,
  title,
  meta,
  rightExtra,
  onClose,
  closeLabel,
}: {
  pillTone: DrawerPillTone;
  pillLabel: string;
  title: string;
  meta?: string;
  rightExtra?: React.ReactNode;
  onClose: () => void;
  closeLabel: string;
}) {
  return (
    <div className="border-b-[0.5px] border-rule-soft px-6 pb-4 pt-5 dark:border-rule-on-dark">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-2">
          <div className="flex items-center gap-2">
            <Pill tone={pillTone}>{pillLabel}</Pill>
            {rightExtra}
          </div>
          <h2 className="font-serif text-2xl leading-tight font-normal tracking-tight text-ink dark:text-foreground">
            {title}
          </h2>
          {meta && (
            <p className="font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute">
              {meta}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute hover:text-ink dark:hover:text-foreground"
          aria-label={closeLabel}
        >
          {closeLabel}
        </button>
      </div>
    </div>
  );
}

export function DrawerFooter({
  primary,
  secondary,
  shortcut,
  bordered = true,
}: {
  primary: { label: string; onClick: () => void; disabled?: boolean };
  secondary: Array<{ label: string; onClick: () => void; disabled?: boolean }>;
  shortcut?: string;
  bordered?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-2 px-6 py-3',
        bordered && 'border-t-[0.5px] border-rule-soft dark:border-rule-on-dark',
      )}
    >
      <div className="flex items-center gap-2">
        <Button variant="accent" size="sm" onClick={primary.onClick} disabled={primary.disabled}>
          {primary.label}
        </Button>
        {secondary.map((b, i) => (
          <Button
            key={i}
            variant={i === 0 ? 'default' : 'outline'}
            size="sm"
            onClick={b.onClick}
            disabled={b.disabled}
          >
            {b.label}
          </Button>
        ))}
      </div>
      {shortcut && (
        <span className="font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute">
          {shortcut}
        </span>
      )}
    </div>
  );
}
