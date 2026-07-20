'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { Button, Card, CardContent, CardHeader, CardTitle, Hero, Input, Label } from '@getmunin/ui';
import { api } from '../api';
import { useTranslateError } from '../i18n/translate-error';

interface Field {
  key: string;
  label: string;
  required: boolean;
  placeholder?: string;
}

interface Pending {
  label: string;
  vendor: string;
  fields: Field[];
}

export function CredentialEntryPage() {
  const t = useTranslations('credentialEntry');
  const translate = useTranslateError();
  const token = useSearchParams().get('token') ?? '';
  const [pending, setPending] = useState<Pending | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ ok: boolean; message: string } | null>(null);

  const load = useCallback(async () => {
    if (!token) {
      setLoadError(t('invalid'));
      return;
    }
    try {
      const p = await api<Pending>(`/v1/credentials?token=${encodeURIComponent(token)}`, {
        anonymous: true,
      });
      setPending(p);
    } catch (err) {
      setLoadError(translate(err));
    }
  }, [token, t, translate]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit() {
    setBusy(true);
    try {
      const res = await api<{ ok: boolean; detail?: string; error?: string }>('/v1/credentials', {
        method: 'POST',
        anonymous: true,
        body: JSON.stringify({ token, secrets: values }),
      });
      setDone({
        ok: res.ok,
        message: res.ok ? (res.detail ?? t('successBody')) : (res.error ?? t('savedButUntested')),
      });
    } catch (err) {
      setDone({ ok: false, message: translate(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-16">
      <Hero eyebrow={t('eyebrow')} title={t('title')} lede={t('lede')} />
      <Card className="mt-8">
        {loadError ? (
          <CardContent className="pt-6">
            <p className="text-sm text-destructive">{loadError}</p>
          </CardContent>
        ) : done ? (
          <CardContent className="pt-6">
            <p className={`text-sm ${done.ok ? 'text-foreground' : 'text-destructive'}`}>
              {done.ok ? t('success') : t('failure')} {done.message}
            </p>
          </CardContent>
        ) : !pending ? (
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">{t('loading')}</p>
          </CardContent>
        ) : (
          <>
            <CardHeader>
              <CardTitle>{pending.label}</CardTitle>
              <p className="text-sm text-muted-foreground">{t('for', { vendor: pending.vendor })}</p>
            </CardHeader>
            <CardContent className="space-y-4">
              {pending.fields.map((f) => (
                <div key={f.key} className="space-y-1.5">
                  <Label>{f.label}</Label>
                  <Input
                    type="password"
                    autoComplete="off"
                    value={values[f.key] ?? ''}
                    placeholder={f.placeholder}
                    onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                  />
                </div>
              ))}
              <Button
                type="button"
                className="w-full"
                onClick={() => void submit()}
                disabled={busy || pending.fields.some((f) => f.required && !values[f.key])}
              >
                {t('submit')}
              </Button>
              <p className="text-xs text-muted-foreground">{t('reassurance')}</p>
            </CardContent>
          </>
        )}
      </Card>
    </div>
  );
}
