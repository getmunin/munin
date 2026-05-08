'use client';

import { useState } from 'react';
import { Download } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { ApiError } from '../api';
import { useTranslateError } from '../i18n/translate-error';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Hero,
} from '@getmunin/ui';

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
      const res = await fetch(`${API_URL}/api/export`, { credentials: 'include' });
      if (!res.ok) {
        throw new ApiError(res.status, await res.text());
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
      <Hero title={t('title')} lede={t('subtitle')} />

      {error && (
        <Card>
          <CardContent className="py-4 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t('cardTitle')}</CardTitle>
          <CardDescription>{t('cardDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={() => void download()} disabled={loading}>
            <Download className="size-4" />
            {loading ? t('preparing') : t('download')}
          </Button>
        </CardContent>
      </Card>
    </>
  );
}
