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
}: {
  vendor: string;
  field: VendorField;
  value: string;
  onChange: (value: string) => void;
}) {
  const tf = useTranslations('integrations.field');
  const base = `${vendor}.${field.key}`;
  const label = tf.has(`${base}.label`) ? tf(`${base}.label`) : field.label;
  const hint = tf.has(`${base}.hint`) ? tf(`${base}.hint`) : undefined;
  const placeholder = tf.has(`${base}.placeholder`)
    ? tf(`${base}.placeholder`)
    : field.placeholder;

  return (
    <div className="flex flex-col gap-1.5">
      <Label className={dialogLabelClass}>{label}</Label>
      <Input
        type={field.secret ? 'password' : 'text'}
        autoComplete="off"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint ? <p className={dialogHintClass}>{hint}</p> : null}
    </div>
  );
}
