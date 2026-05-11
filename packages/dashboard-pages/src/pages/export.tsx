'use client';

import { useState } from 'react';
import { Download } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { ApiError } from '../api';
import { useTranslateError } from '../i18n/translate-error';
import { Button, Card, CardContent, Hero } from '@getmunin/ui';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export function ExportPage() {
  const t = useTranslations('dashboard.export');
  const translate = useTranslateError();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/v1/export`, { credentials: 'include' });
      if (!res.ok) {
        const body = await res.text();
        throw new ApiError({
          status: res.status,
          statusText: res.statusText || 'error',
          endpoint: '/api/v1/export',
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
      setError(translate(err) || t('errors.export'));
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

      {error && (
        <Card>
          <CardContent className="py-4 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      <section className="border border-rule-soft dark:border-rule-on-dark p-8 space-y-4 max-w-2xl">
        <h2 className="font-serif text-2xl text-ink dark:text-foreground">{t('cardTitle')}</h2>
        <p className="text-sm text-ink-soft dark:text-foreground/70 leading-relaxed">
          {t('cardDescription')}
        </p>
        <Button onClick={() => void download()} disabled={loading} className="gap-1.5">
          <Download className="size-3.5" />
          {loading ? t('preparing') : t('download')}
        </Button>
      </section>
    </>
  );
}
