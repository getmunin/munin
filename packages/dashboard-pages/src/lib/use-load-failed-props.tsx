'use client';

import { useCallback } from 'react';
import { useTranslations } from 'next-intl';
import type { ApiError } from '../api';
import type { LoadFailedProps } from '../components/load-failed';

/**
 * Returns a function that builds settings-size `<LoadFailed>` props from an
 * `ApiError`. All visible strings are pulled from `dashboard.loadFailed.*`
 * translations.
 *
 * Usage:
 *   const buildLoadFailed = useSettingsLoadFailedProps();
 *   if (loadError && !hasLoadedOnce) {
 *     return <LoadFailed {...buildLoadFailed('team', loadError, () => void retry(), retrying)} />;
 *   }
 */
export function useSettingsLoadFailedProps() {
  const t = useTranslations('dashboard.loadFailed');
  const tCommon = useTranslations('common');
  return useCallback(
    (
      entity: string,
      error: ApiError,
      onRetry: () => void,
      retrying?: boolean,
    ): LoadFailedProps => ({
      size: 'settings',
      screenLabel: `Settings · ${entity} · failed`,
      eyebrow: t('eyebrow'),
      heading: t.rich('settings.title', { em: (chunks) => <em>{chunks}</em> }),
      lede: t('settings.lede'),
      detail: {
        endpoint: `${error.method} ${error.endpoint}`,
        status: `${error.status} · ${error.statusText}`,
        requestId: error.requestId,
      },
      onRetry,
      retryLabel: t('retry'),
      retryingLabel: tCommon('retrying'),
      autoRetryHint: t('autoRetryHint'),
      retrying,
    }),
    [t, tCommon],
  );
}

/**
 * Returns a function that builds inbox-size `<LoadFailed>` props from an
 * `ApiError`. Inbox uses a larger heading and a flock-themed copy line.
 */
export function useInboxLoadFailedProps() {
  const t = useTranslations('dashboard.loadFailed');
  const tCommon = useTranslations('common');
  return useCallback(
    (
      error: ApiError,
      onRetry: () => void,
      retrying?: boolean,
      lastSeen?: string | null,
    ): LoadFailedProps => ({
      size: 'inbox',
      screenLabel: 'Inbox · fetch failed',
      eyebrow: t('eyebrow'),
      heading: t.rich('inbox.title', { em: (chunks) => <em>{chunks}</em> }),
      lede: t('inbox.lede'),
      detail: {
        endpoint: `${error.method} ${error.endpoint}`,
        status: `${error.status} · ${error.statusText}`,
        requestId: error.requestId,
        lastSeen: lastSeen ?? null,
      },
      onRetry,
      retryLabel: t('retry'),
      retryingLabel: tCommon('retrying'),
      autoRetryHint: t('autoRetryHint'),
      retrying,
    }),
    [t, tCommon],
  );
}
