'use client';

import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';

export function FailureBlock({
  summary,
  detail,
  attempt,
  onDismiss,
}: {
  summary: string;
  detail?: string | null;
  attempt: number;
  onDismiss: () => void;
}) {
  const tCommon = useTranslations('common');

  return (
    <div
      role="alert"
      className="relative border-l-2 border-alert-bad-border bg-alert-bad px-3.5 py-2.5 font-mono text-[11px] leading-[1.55] text-alert-bad-ink dark:border-alert-bad-border"
    >
      <p className="break-all pr-7">
        {summary} ({attempt})
      </p>
      {detail ? <p className="break-all pr-7">{detail}</p> : null}
      <button
        type="button"
        onClick={onDismiss}
        aria-label={tCommon('close')}
        className="absolute right-2.5 top-2.5 opacity-55 transition-opacity duration-fast ease-munin hover:opacity-100"
      >
        <X aria-hidden className="size-4" />
      </button>
    </div>
  );
}

export function FailureBlockRegion({
  summary,
  detail,
  attempt,
  onDismiss,
}: {
  summary: string;
  detail?: string | null;
  attempt: number;
  onDismiss: () => void;
}) {
  return (
    <div className="px-5 pt-3 md:px-7">
      <FailureBlock
        summary={summary}
        detail={detail}
        attempt={attempt}
        onDismiss={onDismiss}
      />
    </div>
  );
}

export function failureSummary(code: string | null, message: string): string {
  if (!code) return message;
  return message.startsWith(code) ? message : `${code}: ${message}`;
}
