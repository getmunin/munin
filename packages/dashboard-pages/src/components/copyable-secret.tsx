'use client';

import { Label } from '@getmunin/ui';
import { dialogLabelClass } from '../lib/dialog-style';
import { CopyField } from './copy-field';

export interface CopyableSecretProps {
  label: string;
  value: string;
  hint?: string;
}

export function CopyableSecret({ label, value, hint }: CopyableSecretProps) {
  return (
    <div className="space-y-2">
      <Label className={dialogLabelClass}>{label}</Label>
      <CopyField value={value} />
      {hint && (
        <p className="text-[13px] text-ink-soft dark:text-foreground/70 leading-snug">{hint}</p>
      )}
    </div>
  );
}
