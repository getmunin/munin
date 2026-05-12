'use client';

import { useState } from 'react';
import { Copy } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button, Label } from '@getmunin/ui';
import { dialogLabelClass } from '../lib/dialog-style';

export interface CopyableSecretProps {
  label: string;
  value: string;
  hint?: string;
}

const COPIED_TIMEOUT_MS = 1500;

export function CopyableSecret({ label, value, hint }: CopyableSecretProps) {
  const t = useTranslations('common');
  const [copied, setCopied] = useState(false);

  function copy() {
    void navigator.clipboard
      .writeText(value)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), COPIED_TIMEOUT_MS);
      })
      .catch((err) => {
        console.warn('[copyable-secret] clipboard.writeText failed', err);
      });
  }

  return (
    <div className="space-y-2">
      <Label className={dialogLabelClass}>{label}</Label>
      <div className="flex items-center gap-2">
        <code className="flex-1 truncate border-[0.5px] border-rule-soft dark:border-rule-on-dark bg-paper dark:bg-card px-3 py-2 font-mono text-sm text-ink dark:text-foreground">
          {value}
        </code>
        <Button variant="outline" size="sm" onClick={copy} className="gap-1.5">
          <Copy className="size-3.5" />
          {copied ? t('copied') : t('copy')}
        </Button>
      </div>
      {hint && (
        <p className="text-[13px] text-ink-soft dark:text-foreground/70 leading-snug">{hint}</p>
      )}
    </div>
  );
}
