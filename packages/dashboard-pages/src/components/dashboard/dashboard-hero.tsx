'use client';

import { useTranslations, useLocale } from 'next-intl';
import { Hero } from '@getmunin/ui';

interface DashboardHeroProps {
  date: Date;
  liveCount: number;
  queueCount: number;
}

export function DashboardHero({ date, liveCount, queueCount }: DashboardHeroProps) {
  const t = useTranslations('dashboard.overview');
  const locale = useLocale();
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

  return (
    <Hero
      eyebrow={eyebrow}
      title={t.rich('title', { em: (chunks) => <em>{chunks}</em> })}
      lede={lede}
    />
  );
}
