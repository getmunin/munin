'use client';

import { cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { Label } from '@getmunin/ui';
import { dialogHintClass, dialogLabelClass } from '../lib/dialog-style';

export interface FormFieldProps {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
}

export function FormField({ label, hint, error, children }: FormFieldProps) {
  const control =
    error && isValidElement(children)
      ? cloneElement(children as ReactElement<{ 'aria-invalid'?: boolean }>, {
          'aria-invalid': true,
        })
      : children;
  return (
    <div className="space-y-2">
      <Label className={dialogLabelClass}>{label}</Label>
      {control}
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
