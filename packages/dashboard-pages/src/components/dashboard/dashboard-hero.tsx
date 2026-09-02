'use client';

import { useTranslations, useLocale } from 'next-intl';
import { Hero } from '@getmunin/ui';
import { authClient } from '../../auth-client';

interface DashboardHeroProps {
  date: Date;
  liveCount: number;
  queueCount: number;
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

export function DashboardHero({ date, liveCount, queueCount }: DashboardHeroProps) {
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

  let lede: string;
  if (liveCount === 0 && queueCount === 0) {
    lede = t('ledeQuiet');
  } else if (liveCount > 0 && queueCount === 0) {
    lede = t('ledeLiveOnly', { count: liveCount });
  } else if (liveCount === 0 && queueCount > 0) {
    lede = t('ledeQueueOnly', { count: queueCount });
  } else {
    lede = t('ledeBoth', { live: liveCount, queue: queueCount });
  }

  const title = name
    ? t.rich(greetingKey(date), { name, em: (chunks) => <em>{chunks}</em> })
    : t.rich('title', { em: (chunks) => <em>{chunks}</em> });

  return <Hero eyebrow={eyebrow} title={title} lede={lede} />;
}
