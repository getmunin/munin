'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '../i18n-navigation';
import { api, ApiError } from '../api';
import { useRealtime } from '../realtime';

type AlertSource =
  | 'llm_provider'
  | 'channel_inbound'
  | 'channel_outbound'
  | 'curator'
  | 'delivery'
  | 'quota';

type AlertSeverity = 'warning' | 'error';

interface AlertDto {
  id: string;
  source: AlertSource;
  subjectId: string | null;
  severity: AlertSeverity;
  title: string;
  detail: string | null;
  metadata: Record<string, unknown>;
  ctaHref: string | null;
  ctaLabelKey: string | null;
  openedAt: string;
  lastSeenAt: string;
  occurrenceCount: number;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  resolvedAt: string | null;
}

const POLL_INTERVAL_MS = 5 * 60_000;
const DISCONNECT_GRACE_MS = 1500;

export function SystemAlertsBanner() {
  const t = useTranslations('dashboard.runnerStatusBanner');
  const [alerts, setAlerts] = useState<AlertDto[]>([]);
  const [hasBeenConnected, setHasBeenConnected] = useState(false);
  const [showDisconnected, setShowDisconnected] = useState(false);
  const cancelledRef = useRef(false);

  const fetchAlerts = useCallback(async () => {
    try {
      const res = await api<{ items: AlertDto[] }>('/v1/system/alerts');
      if (!cancelledRef.current) setAlerts(res.items);
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) return;
    }
  }, []);

  const { status: realtime } = useRealtime([{ channel: 'org' }], (event) => {
    if (
      event.type === 'org_alert.opened' ||
      event.type === 'org_alert.resolved' ||
      event.type === 'org_alert.acknowledged'
    ) {
      void fetchAlerts();
    }
  });

  useEffect(() => {
    if (realtime === 'connected') setHasBeenConnected(true);
  }, [realtime]);

  useEffect(() => {
    if (realtime === 'connected') {
      setShowDisconnected(false);
      return;
    }
    if (!hasBeenConnected) return;
    const handle = window.setTimeout(() => setShowDisconnected(true), DISCONNECT_GRACE_MS);
    return () => window.clearTimeout(handle);
  }, [realtime, hasBeenConnected]);

  useEffect(() => {
    cancelledRef.current = false;
    void fetchAlerts();
    const handle = window.setInterval(() => void fetchAlerts(), POLL_INTERVAL_MS);
    return () => {
      cancelledRef.current = true;
      window.clearInterval(handle);
    };
  }, [fetchAlerts]);

  const state = pickState({ showDisconnected, alerts, t });
  if (!state) return null;

  return (
    <div
      role="alert"
      aria-live="polite"
      className="agent-banner sticky top-0 z-50 h-12 overflow-hidden border-b-[0.5px] border-ink bg-amber-100 text-ink dark:bg-amber-200/90 dark:text-ink"
    >
      <div className="mx-auto flex h-full items-center gap-4 px-4 md:px-10">
        <span className="flex shrink-0 items-center gap-2 whitespace-nowrap border-r border-ink/25 pr-3.5 font-mono text-[10px] uppercase leading-none tracking-[0.16em]">
          <span className="size-[7px] animate-pulse rounded-full bg-ink" aria-hidden />
          {state.tag}
        </span>
        <span className="min-w-0 flex-1 truncate font-sans text-[13px] leading-[1.4]">{state.message}</span>
        {state.cta && (
          <Link
            href={state.cta.href}
            className="hidden h-7 shrink-0 items-center whitespace-nowrap border border-ink bg-transparent px-3 font-mono text-[10px] uppercase leading-none tracking-[0.14em] text-ink transition-colors hover:bg-ink hover:text-amber-100 md:inline-flex"
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
  showDisconnected: boolean;
  alerts: AlertDto[];
  t: ReturnType<typeof useTranslations<'dashboard.runnerStatusBanner'>>;
}): BannerState | null {
  const { showDisconnected, alerts, t } = args;
  if (showDisconnected) {
    return {
      tag: t('disconnectedTag'),
      message: t('disconnectedMessage'),
    };
  }
  const open = alerts.filter((a) => a.resolvedAt === null);
  if (open.length === 0) return null;

  const primary = pickPrimary(open);
  const extra = open.length - 1;
  const cta = ctaForSource(primary.source, t);

  if (primary.source === 'llm_provider') {
    return {
      tag: t('agentOfflineTag'),
      message: t.rich('agentOfflineMessage', {
        reason: describeProviderReason(primary, t),
        em: (chunks) => <em className="font-serif text-[14px] italic">{chunks}</em>,
      }),
      cta,
    };
  }

  const baseReason = describeAlertReason(primary, t);
  const reason =
    extra > 0
      ? t('alertReasonMultiple', { title: baseReason, count: extra })
      : t('alertReasonSingle', { title: baseReason });
  return {
    tag: t('alertOpenTag'),
    message: t.rich('alertOpenMessage', {
      reason,
      em: (chunks) => <em className="font-serif text-[14px] italic">{chunks}</em>,
    }),
    cta,
  };
}

function describeAlertReason(
  alert: AlertDto,
  t: ReturnType<typeof useTranslations<'dashboard.runnerStatusBanner'>>,
): string {
  if (alert.source === 'channel_inbound') {
    const name =
      typeof alert.metadata['channelName'] === 'string'
        ? alert.metadata['channelName']
        : (alert.subjectId ?? '');
    return t('channelInboundFailing', { name });
  }
  return alert.title;
}

function pickPrimary(open: AlertDto[]): AlertDto {
  const errors = open.filter((a) => a.severity === 'error');
  const pool = errors.length > 0 ? errors : open;
  return [...pool].sort((a, b) => (a.openedAt < b.openedAt ? 1 : -1))[0]!;
}

function ctaForSource(
  source: AlertSource,
  t: ReturnType<typeof useTranslations<'dashboard.runnerStatusBanner'>>,
): { href: string; label: string } | undefined {
  switch (source) {
    case 'llm_provider':
      return { href: '/dashboard/settings/ai', label: t('openAiSettings') };
    case 'channel_inbound':
    case 'channel_outbound':
      return { href: '/dashboard/settings/channels', label: t('openChannelSettings') };
    default:
      return undefined;
  }
}

function describeProviderReason(
  alert: AlertDto,
  t: ReturnType<typeof useTranslations<'dashboard.runnerStatusBanner'>>,
): string {
  const code = typeof alert.metadata['code'] === 'string' ? alert.metadata['code'] : null;
  switch (code) {
    case 'provider_auth':
      return t('providerErrorAuth');
    case 'provider_regional':
      return t('providerErrorRegional');
    case 'provider_rate_limit':
      return t('providerErrorRateLimit');
    case 'provider_model_not_found':
      return t('providerErrorModelNotFound');
    default: {
      const raw = alert.detail ?? t('providerUnavailable');
      return raw.length > 140 ? `${raw.slice(0, 140)}…` : raw;
    }
  }
}
