'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '../i18n-navigation';
import { api, ApiError } from '../api';
import { useRealtime, type RealtimeStatus } from '../realtime';

type ProviderErrorCode =
  | 'provider_auth'
  | 'provider_regional'
  | 'provider_rate_limit'
  | 'provider_model_not_found'
  | 'provider_other';

interface AgentHealthDto {
  id: string;
  status: 'ok' | 'degraded';
  lastProviderErrorCode: ProviderErrorCode | null;
  lastProviderErrorMessage: string | null;
  lastErrorAt: string | null;
  lastOkAt: string | null;
}

const POLL_INTERVAL_MS = 30_000;

export function AgentHealthBanner() {
  const t = useTranslations('dashboard.runnerStatusBanner');
  const [health, setHealth] = useState<AgentHealthDto | null>(null);
  const [hasBeenConnected, setHasBeenConnected] = useState(false);
  const cancelledRef = useRef(false);

  const fetchHealth = useCallback(async () => {
    try {
      const dto = await api<AgentHealthDto>('/v1/agent-health');
      if (!cancelledRef.current) setHealth(dto);
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) return;
    }
  }, []);

  const { status: realtime } = useRealtime([{ channel: 'org' }], (event) => {
    if (event.type === 'agent.config.updated') {
      void fetchHealth();
    }
  });

  useEffect(() => {
    if (realtime === 'connected') setHasBeenConnected(true);
  }, [realtime]);

  useEffect(() => {
    cancelledRef.current = false;
    void fetchHealth();
    const handle = window.setInterval(() => void fetchHealth(), POLL_INTERVAL_MS);
    return () => {
      cancelledRef.current = true;
      window.clearInterval(handle);
    };
  }, [fetchHealth]);

  const state = pickState({ realtime, hasBeenConnected, health, t });
  if (!state) return null;

  return (
    <div
      role="alert"
      aria-live="polite"
      className="border-b-[0.5px] border-ink bg-amber-100 text-ink dark:bg-amber-200/90 dark:text-ink"
    >
      <div className="mx-auto flex items-center gap-4 px-10 py-2.5">
        <span className="flex shrink-0 items-center gap-2 whitespace-nowrap border-r border-ink/25 pr-3.5 font-mono text-[10px] uppercase tracking-[0.16em]">
          <span className="size-[7px] animate-pulse rounded-full bg-ink" aria-hidden />
          {state.tag}
        </span>
        <span className="min-w-0 flex-1 font-sans text-[13px] leading-[1.4]">{state.message}</span>
        {state.cta && (
          <Link
            href={state.cta.href}
            className="whitespace-nowrap border border-ink bg-transparent px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-ink transition-colors hover:bg-ink hover:text-amber-100"
          >
            {state.cta.label}
          </Link>
        )}
      </div>
    </div>
  );
}

interface BannerState {
  tag: string;
  message: ReactNode;
  cta?: { href: string; label: string };
}

function pickState(args: {
  realtime: RealtimeStatus;
  hasBeenConnected: boolean;
  health: AgentHealthDto | null;
  t: ReturnType<typeof useTranslations<'dashboard.runnerStatusBanner'>>;
}): BannerState | null {
  const { realtime, hasBeenConnected, health, t } = args;
  if (hasBeenConnected && realtime !== 'connected') {
    return {
      tag: t('disconnectedTag'),
      message: t('disconnectedMessage'),
    };
  }
  if (health && health.status === 'degraded') {
    const reason = describeReason(health, t);
    return {
      tag: t('agentOfflineTag'),
      message: t.rich('agentOfflineMessage', {
        reason,
        em: (chunks) => <em className="font-serif text-[14px] italic">{chunks}</em>,
      }),
      cta: { href: '/dashboard/settings/ai', label: t('openAiSettings') },
    };
  }
  return null;
}

function describeReason(
  health: AgentHealthDto,
  t: ReturnType<typeof useTranslations<'dashboard.runnerStatusBanner'>>,
): string {
  switch (health.lastProviderErrorCode) {
    case 'provider_auth':
      return t('providerErrorAuth');
    case 'provider_regional':
      return t('providerErrorRegional');
    case 'provider_rate_limit':
      return t('providerErrorRateLimit');
    case 'provider_model_not_found':
      return t('providerErrorModelNotFound');
    case 'provider_other':
    default: {
      const raw = health.lastProviderErrorMessage ?? t('providerUnavailable');
      return raw.length > 140 ? `${raw.slice(0, 140)}…` : raw;
    }
  }
}
