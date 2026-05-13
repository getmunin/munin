'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { RealtimeStatus } from '../realtime';

export function ConnectionBanner({ status }: { status: RealtimeStatus }) {
  const t = useTranslations('dashboard.connectionBanner');
  const [hasBeenConnected, setHasBeenConnected] = useState(false);
  useEffect(() => {
    if (status === 'connected') setHasBeenConnected(true);
  }, [status]);
  if (!hasBeenConnected || status === 'connected') return null;
  return (
    <div
      role="status"
      className="border-b-[0.5px] border-amber-300 bg-amber-50 px-4 py-2 text-center text-sm font-sans text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
    >
      {t('offline')}
    </div>
  );
}
