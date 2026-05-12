'use client';

import type { ReactNode } from 'react';
import { Check, AlertCircle } from 'lucide-react';
import { cn } from '@getmunin/ui';

type Tone = 'good' | 'bad';

interface AuthInviteCardProps {
  tone: Tone;
  badge: string;
  title: ReactNode;
  body: ReactNode;
  meta?: Array<{ label: string; value: string }>;
  primary?: ReactNode;
  secondary?: ReactNode;
}

export function AuthInviteCard({
  tone,
  badge,
  title,
  body,
  meta,
  primary,
  secondary,
}: AuthInviteCardProps) {
  return (
    <div
      className={cn(
        'w-full rounded-[18px] px-9 pb-8 pt-9',
        tone === 'good' ? 'bg-invite-good text-ink' : 'bg-invite-bad text-ink',
      )}
    >
      <div
        className={cn(
          'mb-7 inline-flex items-center gap-2 text-[14px]',
          tone === 'good' ? 'text-invite-good-ink' : 'text-invite-bad-ink',
        )}
      >
        {tone === 'good' ? (
          <Check className="size-[18px]" strokeWidth={2.2} />
        ) : (
          <AlertCircle className="size-[18px]" strokeWidth={2.2} />
        )}
        {badge}
      </div>
      <h2 className="m-0 mb-[18px] font-serif text-[44px] font-normal leading-[1.05] tracking-[-0.02em] text-ink">
        {title}
      </h2>
      <div className="mb-7 max-w-[440px] text-[15px] leading-[1.55] text-ink">{body}</div>
      {meta && meta.length > 0 && (
        <dl className="mb-6 mt-0 grid grid-cols-[auto_1fr] gap-x-[18px] gap-y-1.5 border-t-[0.5px] border-ink/[0.12] pt-[18px] font-mono text-[11px] tracking-wide text-ink-soft">
          {meta.map(({ label, value }) => (
            <div key={label} className="contents">
              <dt className="text-[10px] uppercase tracking-eyebrow text-ink-mute">
                {label}
              </dt>
              <dd className="m-0 text-ink">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {primary && <div className="inline-flex items-center">{primary}</div>}
      {secondary && (
        <div className="mt-4 inline-flex items-center">
          <div className="ml-1.5">{secondary}</div>
        </div>
      )}
    </div>
  );
}
