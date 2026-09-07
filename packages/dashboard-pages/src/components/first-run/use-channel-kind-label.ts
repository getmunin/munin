'use client';

import { useCallback } from 'react';
import { useTranslations } from 'next-intl';
import type { SetupChannelType } from './setup-snapshot';

export function useChannelKindLabel(): (type: SetupChannelType) => string {
  const t = useTranslations('dashboard.firstRun.channelKind');
  return useCallback((type: SetupChannelType) => t(type), [t]);
}
