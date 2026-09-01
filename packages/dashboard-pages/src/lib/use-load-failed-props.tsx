'use client';

import { useCallback } from 'react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import type { ApiError } from '../api';
import { useTranslateError } from '../i18n/translate-error';
import type { LoadFailedProps } from '../components/load-failed';

export function usePaneLoadFailedProps() {
  const t = useTranslations('dashboard.loadFailed');
  const tCommon = useTranslations('common');
  const translateErr = useTranslateError();
  return useCallback(
    (
      heading: ReactNode,
      screenLabel: string,
      error: ApiError,
      onRetry: () => void,
      retrying?: boolean,
    ): LoadFailedProps => ({
      size: 'pane',
      screenLabel,
      eyebrow: t('eyebrow'),
      heading,
      lede: translateErr(error),
      detail: {
        endpoint: `${error.method} ${error.endpoint}`,
        status: `${error.status} · ${error.statusText}`,
        requestId: error.requestId,
      },
      onRetry,
      retryLabel: t('retry'),
      retryingLabel: tCommon('retrying'),
      retrying,
    }),
    [t, tCommon, translateErr],
  );
}

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
