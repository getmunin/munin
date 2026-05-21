'use client';

import { useCallback } from 'react';
import { useTranslations } from 'next-intl';

export function useRelative(): (iso: string) => string {
  const t = useTranslations('dashboard.overview.relative');
  return useCallback(
    (iso: string): string => {
      const d = new Date(iso).getTime();
      const diff = Date.now() - d;
      if (diff < 60_000) return t('justNow');
      if (diff < 3_600_000) return t('minutes', { n: Math.floor(diff / 60_000) });
      if (diff < 86_400_000) return t('hours', { n: Math.floor(diff / 3_600_000) });
      return t('days', { n: Math.floor(diff / 86_400_000) });
    },
    [t],
  );
}
