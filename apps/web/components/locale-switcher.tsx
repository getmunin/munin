'use client';

import { useTransition } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { setLocaleCookie } from '@/i18n/actions';
import { SUPPORTED_LOCALES } from '@/i18n/locales';

export function LocaleSwitcher({ className }: { className?: string }) {
  const t = useTranslations('locale');
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <label className={className}>
      <span className="sr-only">{t('label')}</span>
      <select
        aria-label={t('label')}
        value={locale}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.value;
          startTransition(async () => {
            await setLocaleCookie(next);
            router.refresh();
          });
        }}
        className="rounded-md border bg-background px-2 py-1 text-sm"
      >
        {SUPPORTED_LOCALES.map((code) => (
          <option key={code} value={code}>
            {t(code)}
          </option>
        ))}
      </select>
    </label>
  );
}
