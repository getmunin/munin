'use client';

import { useTranslations } from 'next-intl';
import type { QueueActionError } from './inbox-types';

export function QueueActionErrorBanner({
  error,
  onDismiss,
}: {
  error: QueueActionError;
  onDismiss: () => void;
}) {
  const t = useTranslations('dashboard.overview.queue');
  const tCommon = useTranslations('common');
  if (!error) return null;

  return (
    <div
      role="alert"
      className="flex items-center gap-3 border-b border-rule-soft px-4 py-2.5 text-[13px] font-medium text-destructive md:px-5 dark:border-rule-on-dark"
    >
      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-current" />
      <span className="min-w-0 flex-1">
        {t(`actionFailed.${error.type}`)} · {error.message}
      </span>
      <button
        type="button"
        onClick={onDismiss}
        className="shrink-0 underline underline-offset-[3px]"
      >
        {tCommon('close')}
      </button>
    </div>
  );
}
