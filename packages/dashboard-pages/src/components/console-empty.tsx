import type { ReactNode } from 'react';

export function ConsoleEmptyText({ title, body }: { title?: ReactNode; body: ReactNode }) {
  return (
    <>
      {title ? (
        <p className="mb-1.5 font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute">
          {title}
        </p>
      ) : null}
      <p className="max-w-[46ch] text-[13px] leading-relaxed text-ink-soft dark:text-foreground/80">
        {body}
      </p>
    </>
  );
}

export function ConsoleListEmpty({ title, body }: { title?: ReactNode; body: ReactNode }) {
  return (
    <li className="px-5 py-5">
      <ConsoleEmptyText title={title} body={body} />
    </li>
  );
}
