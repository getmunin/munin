import { cn } from '@getmunin/ui';

export function PaneNotice({
  tone = 'bad',
  eyebrow,
  action,
  className,
  children,
}: {
  tone?: 'bad' | 'info';
  eyebrow?: string;
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  const filled = Boolean(eyebrow) || Boolean(action);

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-x-4 gap-y-1 border-l-2',
        filled ? 'px-3 py-2' : 'py-1 pl-3',
        tone === 'bad' ? 'border-alert-bad-border' : 'border-cobalt',
        filled && (tone === 'bad' ? 'bg-alert-bad' : 'bg-cobalt/[0.06] dark:bg-cobalt/10'),
        className,
      )}
    >
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        {eyebrow ? (
          <span
            className={cn(
              'font-mono text-[10px] font-medium uppercase tracking-eyebrow',
              tone === 'bad' ? 'text-alert-bad-ink' : 'text-cobalt dark:text-cobalt-soft',
            )}
          >
            {eyebrow}
          </span>
        ) : null}
        <span
          className={cn(
            'text-[13px] leading-relaxed',
            filled || tone === 'info'
              ? 'text-ink dark:text-foreground'
              : 'text-alert-bad-ink',
          )}
        >
          {children}
        </span>
      </span>
      {action ? <span className="shrink-0">{action}</span> : null}
    </div>
  );
}
