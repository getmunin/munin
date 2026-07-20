'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from '@getmunin/ui';
import { api } from '../../api';
import { useTranslateError } from '../../i18n/translate-error';
import { notify } from '../../lib/notify';
import { CardSkeleton } from '../skeleton';
import { useConfirm } from '../confirm-dialog';

interface SlackRouteDto {
  id: string;
  slackChannelId: string;
  slackChannelName: string | null;
  purpose: string;
  mention: string | null;
}

interface SlackStatusDto {
  appConfigured: boolean;
  connected: boolean;
  integration: {
    teamId: string;
    teamName: string | null;
    routes: SlackRouteDto[];
  } | null;
  deliveries: { pending: number; failedLastDay: number };
}

export function SlackCard() {
  const t = useTranslations('integrations.slack');
  const tCommon = useTranslations('common');
  const translate = useTranslateError();
  const confirm = useConfirm();

  const [status, setStatus] = useState<SlackStatusDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [channelId, setChannelId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [botMissing, setBotMissing] = useState(false);

  async function refresh() {
    try {
      const res = await api<SlackStatusDto>('/v1/slack');
      setStatus(res);
      setLoadError(null);
      const defaultRoute = res.integration?.routes.find((r) => r.purpose === 'default');
      if (defaultRoute) setChannelId(defaultRoute.slackChannelId);
    } catch (err) {
      setLoadError(translate(err));
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(translate(err));
    } finally {
      setBusy(false);
    }
  }

  function connect() {
    void run(async () => {
      const res = await api<{ url: string }>('/v1/slack/install-url');
      window.location.assign(res.url);
    });
  }

  function saveRouting() {
    void run(async () => {
      const route = await api<SlackRouteDto & { botInChannel: boolean }>('/v1/slack/routing', {
        method: 'PUT',
        body: JSON.stringify({ slackChannelId: channelId.trim() }),
      });
      setBotMissing(!route.botInChannel);
      notify.success(t('routingSaved'));
      await refresh();
    });
  }

  function sendTest() {
    void run(async () => {
      await api('/v1/slack/test', { method: 'POST' });
      notify.success(t('testSent'));
    });
  }

  async function disconnect() {
    const ok = await confirm({
      title: t('disconnect'),
      message: t('disconnectConfirm'),
      confirmLabel: t('disconnect'),
      cancelLabel: tCommon('cancel'),
      destructive: true,
    });
    if (!ok) return;
    void run(async () => {
      await api('/v1/slack', { method: 'DELETE' });
      setChannelId('');
      setBotMissing(false);
      await refresh();
    });
  }

  if (loadError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
          <CardDescription>{t('lede')}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-destructive">{loadError}</p>
        </CardContent>
      </Card>
    );
  }
  if (!status) return <CardSkeleton />;

  const defaultRoute = status.integration?.routes.find((r) => r.purpose === 'default');

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('lede')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!status.appConfigured ? (
          <p className="text-sm text-muted-foreground">{t('notConfigured')}</p>
        ) : !status.connected ? (
          <Button type="button" onClick={connect} disabled={busy}>
            {t('connect')}
          </Button>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              {t('connectedTo', {
                workspace: status.integration?.teamName ?? status.integration?.teamId ?? '',
              })}
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="slackChannelId">{t('channelLabel')}</Label>
              <Input
                id="slackChannelId"
                value={channelId}
                onChange={(e) => setChannelId(e.target.value)}
                placeholder="C0123456789"
              />
              <p className="text-xs text-muted-foreground">{t('channelHint')}</p>
            </div>
            {botMissing && <p className="text-sm text-amber-600">{t('inviteBot')}</p>}
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                onClick={saveRouting}
                disabled={busy || channelId.trim().length === 0}
              >
                {busy ? tCommon('saving') : t('saveRouting')}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={sendTest}
                disabled={busy || !defaultRoute}
              >
                {t('sendTest')}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => void disconnect()}
                disabled={busy}
              >
                {t('disconnect')}
              </Button>
            </div>
            {status.deliveries.failedLastDay > 0 && (
              <p className="text-sm text-amber-600">
                {t('failedDeliveries', { count: status.deliveries.failedLastDay })}
              </p>
            )}
          </>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
