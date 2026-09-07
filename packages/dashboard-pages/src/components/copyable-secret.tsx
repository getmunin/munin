'use client';

import { Label } from '@getmunin/ui';
import { dialogHintClass, dialogLabelClass } from '../lib/dialog-style';
import { CopyField, type CopyFieldVariant } from './copy-field';

export interface CopyableSecretProps {
  label: string;
  value: string;
  hint?: string;
  variant?: CopyFieldVariant;
}

export function CopyableSecret({ label, value, hint, variant = 'plate' }: CopyableSecretProps) {
  return (
    <div className="space-y-2">
      <Label className={dialogLabelClass}>{label}</Label>
      <CopyField value={value} variant={variant} />
      {hint &&
        (variant === 'field' ? (
          <p className={dialogHintClass}>{hint}</p>
        ) : (
          <p className="text-[13px] text-ink-soft dark:text-foreground/70 leading-snug">{hint}</p>
        ))}
    </div>
  );
}
