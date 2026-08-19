'use client';

import { cn } from '@getmunin/ui';

import { ApiError } from '../api';

export interface FormErrorDetail {
  message: string;
  requestId: string | null;
}

export function toFormError(err: unknown, message: string): FormErrorDetail {
  return { message, requestId: err instanceof ApiError ? err.requestId : null };
}

export function FormError({
  detail,
  pinned = false,
}: {
  detail: FormErrorDetail;
  pinned?: boolean;
}) {
  return (
    <div
      role="alert"
      className={cn(
        'space-y-1',
        pinned
          ? 'my-4 border-t-[1px] border-rule-soft pt-4 dark:border-rule-on-dark'
          : 'border-[1px] border-destructive/40 bg-destructive/5 px-3.5 py-3 dark:bg-destructive/10',
      )}
    >
      <p className="text-sm leading-snug text-destructive">{detail.message}</p>
      {detail.requestId && (
        <p className="break-all font-mono text-[11px] text-ink-mute">
          request_id {detail.requestId}
        </p>
      )}
    </div>
  );
}
