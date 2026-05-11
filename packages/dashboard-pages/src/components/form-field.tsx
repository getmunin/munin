'use client';

import type { ReactNode } from 'react';
import { Label } from '@getmunin/ui';
import { dialogHintClass, dialogLabelClass } from '../lib/dialog-style';

export interface FormFieldProps {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
}

/**
 * Standard label + control + hint/error wrapper for dialog forms.
 * Pass `error` (a localized string) to swap the hint for a destructive
 * message and switch the visual state. Pair with `aria-invalid` on the
 * underlying input.
 */
export function FormField({ label, hint, error, children }: FormFieldProps) {
  return (
    <div className="space-y-2">
      <Label className={dialogLabelClass}>{label}</Label>
      {children}
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className={dialogHintClass}>{hint}</p>
      ) : null}
    </div>
  );
}
