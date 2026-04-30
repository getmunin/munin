'use client';

import { useEffect, useState } from 'react';
import { Activity } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { api } from '../api';
import { useTranslateError } from '../i18n/translate-error';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@getmunin/ui';
import { cn } from '@getmunin/ui';

interface UsageDto {
  minute: { used: number; limit: number; resetAt: string };
  day: { used: number; limit: number; resetAt: string };
}

export function UsagePage() {
  const t = useTranslations('dashboard.usage');
  const translate = useTranslateError();
  const [usage, setUsage] = useState<UsageDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const u = await api<UsageDto>('/api/usage');
        if (active) {
          setUsage(u);
          setError(null);
        }
      } catch (err) {
        if (active) setError(translate(err) || t('errors.load'));
      }
    }
    void load();
    const id = setInterval(() => void load(), 30_000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [t, translate]);

  return (
    <>
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </header>

      {error && (
        <Card>
          <CardContent className="py-4 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      {usage && (
        <div className="grid gap-4 md:grid-cols-2">
          <UsageCard label={t('perMinute')} data={usage.minute} />
          <UsageCard label={t('perDay')} data={usage.day} />
        </div>
      )}
    </>
  );
}

function UsageCard({
  label,
  data,
}: {
  label: string;
  data: { used: number; limit: number; resetAt: string };
}) {
  const t = useTranslations('dashboard.usage');
  const pct = data.limit === 0 ? 0 : Math.min(100, Math.round((data.used / data.limit) * 100));
  const tone = pct >= 90 ? 'bg-destructive' : pct >= 70 ? 'bg-amber-500' : 'bg-emerald-500';
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Activity className="size-5 text-muted-foreground" />
          <CardTitle className="text-base">{label}</CardTitle>
        </div>
        <CardDescription>
          {t('summary', {
            used: data.used,
            limit: data.limit,
            resetIn: formatResetIn(data.resetAt, t),
          })}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-2 overflow-hidden rounded-full bg-muted">
          <div className={cn('h-full transition-all', tone)} style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{t('percentUsed', { pct })}</p>
      </CardContent>
    </Card>
  );
}

function formatResetIn(iso: string, t: ReturnType<typeof useTranslations<'dashboard.usage'>>): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms < 0) return t('resetNow');
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return t('resetMinutes', { minutes });
  const hours = Math.round(minutes / 60);
  return t('resetHours', { hours });
}
