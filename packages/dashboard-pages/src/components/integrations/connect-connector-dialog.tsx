'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Dialog, DialogContent, Input, Label } from '@getmunin/ui';
import { api } from '../../api';
import { notify } from '../../lib/notify';
import { useTranslateError } from '../../i18n/translate-error';
import { VendorIcon, vendorPresentation } from './vendor-catalog';

export interface ConnectVendor {
  vendor: string;
  domain: string;
  displayName: string;
  configFields: Array<{ key: string; label: string; required: boolean; secret?: boolean; placeholder?: string }>;
}

/**
 * App Store product-page connect dialog (design 1d): vendor header + Read-only
 * pill, a left "what agents get" capability panel, and the config form on the
 * right. Secrets are entered inline (no link button); the one-time link stays
 * the agent path.
 */
export function ConnectConnectorDialog({
  vendor,
  onClose,
  onDone,
}: {
  vendor: ConnectVendor;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const t = useTranslations('integrations.connectors');
  const tc = useTranslations('integrations.catalog');
  const tCommon = useTranslations('common');
  const translate = useTranslateError();
  const present = vendorPresentation(vendor.vendor, vendor.domain);
  const [name, setName] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const missingRequired = vendor.configFields.some((f) => f.required && !values[f.key]);

  async function submit() {
    setBusy(true);
    try {
      const config: Record<string, string> = {};
      for (const f of vendor.configFields) if (values[f.key]) config[f.key] = values[f.key]!;
      await api('/v1/connectors', {
        method: 'POST',
        body: JSON.stringify({ vendor: vendor.vendor, name, config }),
      });
      notify.success(t('created'));
      await onDone();
    } catch (err) {
      notify.error(translate(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[720px] p-0">
        <div className="flex items-center gap-4 border-b-[0.5px] border-rule-soft px-8 py-6 dark:border-rule-on-dark">
          <VendorIcon vendor={vendor.vendor} label={vendor.displayName} size={56} markSize={28} />
          <div className="flex flex-1 flex-col gap-1">
            <h2 className="font-serif text-2xl leading-none text-ink dark:text-foreground">
              {t('connectVendor', { vendor: vendor.displayName })}
            </h2>
            <span className="font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute">
              {tc(`category.${present.categoryKey}`)}
            </span>
          </div>
          <span className="inline-flex flex-none items-center gap-1.5 px-1.5 py-1 font-mono text-[9px] uppercase tracking-eyebrow text-ink shadow-[inset_0_0_0_0.5px_currentColor] dark:text-foreground">
            <span className="size-[5px] rounded-full bg-current" />
            {t('readOnly')}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-[260px_1fr]">
          <div className="flex flex-col gap-4 border-b-[0.5px] border-rule-soft bg-paper-deep px-7 py-6 dark:border-rule-on-dark dark:bg-secondary sm:border-b-0 sm:border-r-[0.5px]">
            <span className="font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute">
              {t('whatAgentsGet')}
            </span>
            <div className="flex flex-col">
              {present.capabilityKeys.map((k) => (
                <div key={k} className="border-b-[0.5px] border-rule-soft py-2.5 last:border-0 dark:border-rule-on-dark">
                  <span className="block text-[13px] leading-snug text-ink dark:text-foreground">
                    {tc(`capability.${k}`)}
                  </span>
                </div>
              ))}
            </div>
            <p className="font-serif text-sm italic text-ink-mute">{t('readLive')}</p>
          </div>

          <div className="flex flex-col gap-4 px-8 py-6">
            <div className="flex flex-col gap-1.5">
              <Label>{t('name')}</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('namePlaceholder')} />
            </div>
            {vendor.configFields.map((f) => (
              <div key={f.key} className="flex flex-col gap-1.5">
                <Label>{f.label}</Label>
                <Input
                  type={f.secret ? 'password' : 'text'}
                  autoComplete="off"
                  value={values[f.key] ?? ''}
                  placeholder={f.placeholder}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                />
              </div>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-2.5 border-t-[0.5px] border-rule-soft bg-paper-deep px-8 py-3.5 dark:border-rule-on-dark dark:bg-secondary">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            {tCommon('cancel')}
          </Button>
          <Button type="button" onClick={() => void submit()} disabled={busy || !name || missingRequired}>
            {t('create')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
