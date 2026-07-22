'use client';

import { useTranslations } from 'next-intl';
import { Input, Label } from '@getmunin/ui';
import { dialogHintClass, dialogLabelClass } from '../../lib/dialog-style';

export interface VendorField {
  key: string;
  label: string;
  required: boolean;
  secret?: boolean;
  placeholder?: string;
}

export function VendorFieldRow({
  vendor,
  field,
  value,
  onChange,
  error,
}: {
  vendor: string;
  field: VendorField;
  value: string;
  onChange: (value: string) => void;
  error?: string | null;
}) {
  const tf = useTranslations('integrations.field');
  const base = `${vendor}.${field.key}`;
  const label = tf.has(`${base}.label`) ? tf(`${base}.label`) : field.label;
  const hint = tf.has(`${base}.hint`) ? tf(`${base}.hint`) : undefined;
  const placeholder = tf.has(`${base}.placeholder`)
    ? tf(`${base}.placeholder`)
    : field.placeholder;
  const errorText = error ? (tf.has(`${base}.invalid`) ? tf(`${base}.invalid`) : error) : null;

  return (
    <div className="flex flex-col gap-1.5">
      <Label className={dialogLabelClass}>{label}</Label>
      <Input
        type={field.secret ? 'password' : 'text'}
        autoComplete="off"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={errorText ? true : undefined}
      />
      {errorText ? (
        <p className="text-sm text-destructive" role="alert">
          {errorText}
        </p>
      ) : hint ? (
        <p className={dialogHintClass}>{hint}</p>
      ) : null}
    </div>
  );
}
