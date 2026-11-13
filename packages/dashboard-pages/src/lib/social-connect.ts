'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { api } from '../api';
import { notify } from './notify';

const SOCIAL_OUTCOME_PARAMS = ['social', 'platform', 'pending', 'reason', 'returnTo'] as const;

export const PLATFORM_NAMES: Record<string, string> = { linkedin: 'LinkedIn', facebook: 'Facebook' };

export function platformName(platform: string): string {
  return PLATFORM_NAMES[platform] ?? platform;
}

export function currentReturnPath(): string {
  const params = new URLSearchParams(window.location.search);
  for (const key of SOCIAL_OUTCOME_PARAMS) params.delete(key);
  const query = params.toString();
  return `${window.location.pathname}${query ? `?${query}` : ''}`;
}

export function isDashboardPath(raw: string | null): raw is string {
  return raw !== null && raw.length <= 512 && /^\/(?![/\\])[^\s\\#]*$/.test(raw);
}

export function withSocialOutcome(path: string, platform: string): string {
  return `${path}${path.includes('?') ? '&' : '?'}social=connected&platform=${encodeURIComponent(platform)}`;
}

export async function startSocialConnect(platform: string, returnTo?: string): Promise<void> {
  const res = await api<{ url: string }>('/v1/social/accounts/authorize-url', {
    method: 'POST',
    body: JSON.stringify(returnTo ? { platform, returnTo } : { platform }),
  });
  window.location.assign(res.url);
}

export function useSocialConnectOutcome(
  onChooseTarget?: (choice: { pendingId: string; platform: string; returnTo: string | null }) => void,
) {
  const t = useTranslations('integrations.publishing');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const outcome = params.get('social');
    if (!outcome) return;
    const reason = params.get('reason');
    const pending = params.get('pending');
    if (outcome === 'choose_target' && pending) {
      const returnTo = params.get('returnTo');
      onChooseTarget?.({
        pendingId: pending,
        platform: params.get('platform') ?? '',
        returnTo: isDashboardPath(returnTo) ? returnTo : null,
      });
    } else if (outcome === 'connected') notify.success(t('connected'));
    else if (outcome === 'denied') notify.error(t('denied'));
    else notify.error(reason ? t('failedWithReason', { reason }) : t('failed'));
    for (const key of SOCIAL_OUTCOME_PARAMS) params.delete(key);
    const query = params.toString();
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${query ? `?${query}` : ''}`,
    );
  }, [t, onChooseTarget]);
}
