'use client';

import { useTranslations, useLocale } from 'next-intl';
import { Hero } from '@getmunin/ui';
import { authClient } from '../../auth-client';

interface DashboardHeroProps {
  date: Date;
  liveCount: number;
}

export function firstName(name: string | null | undefined): string | null {
  const trimmed = (name ?? '').trim();
  if (!trimmed || trimmed.includes('@')) return null;
  const first = trimmed.split(/\s+/)[0] ?? '';
  return first.length > 0 && first.length <= 24 ? first : null;
}

export function greetingKey(
  date: Date,
): 'greetingLateNight' | 'greetingMorning' | 'greetingAfternoon' | 'greetingEvening' {
  const hour = date.getHours();
  if (hour < 5) return 'greetingLateNight';
  if (hour < 12) return 'greetingMorning';
  if (hour < 18) return 'greetingAfternoon';
  return 'greetingEvening';
}

export function DashboardHero({ date, liveCount }: DashboardHeroProps) {
  const t = useTranslations('dashboard.overview');
  const locale = useLocale();
  const { data: session } = authClient.useSession();
  const name = firstName(session?.user?.name);
  const dateLabel = new Intl.DateTimeFormat(locale, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
  const eyebrow = dateLabel;

  const lede = liveCount === 0 ? t('ledeQuiet') : t('ledeLiveOnly', { count: liveCount });

  const title = name
    ? t.rich(greetingKey(date), { name, em: (chunks) => <em>{chunks}</em> })
    : t.rich('title', { em: (chunks) => <em>{chunks}</em> });

  return <Hero eyebrow={eyebrow} title={title} lede={lede} />;
}
