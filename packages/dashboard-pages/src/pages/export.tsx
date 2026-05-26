'use client';

import { useState } from 'react';
import { Download } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { ApiError } from '../api';
import { useTranslateError } from '../i18n/translate-error';
import { notify } from '../lib/notify';
import { Button, Hero } from '@getmunin/ui';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export function ExportPage() {
  const t = useTranslations('dashboard.export');
  const translate = useTranslateError();
  const [loading, setLoading] = useState(false);

  async function download() {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/v1/export`, { credentials: 'include' });
      if (!res.ok) {
        const body = await res.text();
        throw new ApiError({
          status: res.status,
          statusText: res.statusText || 'error',
          endpoint: '/v1/export',
          method: 'GET',
          requestId: res.headers.get('x-request-id'),
          message: body || `${res.status} ${res.statusText}`,
        });
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const date = new Date().toISOString().slice(0, 10);
      a.download = `munin-export-${date}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      notify.error(translate(err) || t('errors.export'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Hero
        eyebrow={t('eyebrow')}
        title={t.rich('title', { em: (chunks) => <em>{chunks}</em> })}
        lede={t('subtitle')}
      />

      <section className="border-[0.5px] border-rule-soft dark:border-rule-on-dark p-8 space-y-4 max-w-2xl">
        <h2 className="font-serif text-2xl text-ink dark:text-foreground">{t('cardTitle')}</h2>
        <p className="text-sm text-ink-soft dark:text-foreground/70 leading-relaxed">
          {t('cardDescription')}
        </p>
        <Button onClick={() => void download()} pending={loading} className="gap-1.5">
          <Download className="size-3.5" />
          {loading ? t('preparing') : t('download')}
        </Button>
      </section>
    </>
  );
}
