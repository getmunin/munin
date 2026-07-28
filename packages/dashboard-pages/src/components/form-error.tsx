'use client';

import { ApiError } from '../api';

export interface FormErrorDetail {
  message: string;
  requestId: string | null;
}

export function toFormError(err: unknown, message: string): FormErrorDetail {
  return { message, requestId: err instanceof ApiError ? err.requestId : null };
}

export function FormError({ detail }: { detail: FormErrorDetail }) {
  return (
    <div
      role="alert"
      className="space-y-1 border-[1px] border-destructive/40 bg-destructive/5 px-3.5 py-3"
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
