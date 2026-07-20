'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input, Label } from '@getmunin/ui';
import { api } from '../../api';
import { notify } from '../../lib/notify';
import { useTranslateError } from '../../i18n/translate-error';
import { useConfirm } from '../confirm-dialog';
import { CardSkeleton } from '../skeleton';
import { CardGrid, IntegrationCard, SectionHeading, StatusPill } from './integration-card';

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
  integration: { teamId: string; teamName: string | null; routes: SlackRouteDto[] } | null;
  deliveries: { pending: number; failedLastDay: number };
}

export function OperatorBridgesSection() {
  const t = useTranslations('integrations.slack');
  const tc = useTranslations('integrations.catalog');
  const tb = useTranslations('integrations.operatorBridges');
  const tConn = useTranslations('integrations.connectors');
  const tCommon = useTranslations('common');
  const translate = useTranslateError();
  const confirm = useConfirm();

  const [status, setStatus] = useState<SlackStatusDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [configuring, setConfiguring] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setStatus(await api<SlackStatusDto>('/v1/slack'));
      setLoadError(null);
    } catch (err) {
      setLoadError(translate(err));
    }
  }, [translate]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function connect() {
    setBusy(true);
    void (async () => {
      try {
        const res = await api<{ url: string }>('/v1/slack/install-url');
        window.location.assign(res.url);
      } catch (err) {
        notify.error(translate(err));
        setBusy(false);
      }
    })();
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
    setBusy(true);
    try {
      await api('/v1/slack', { method: 'DELETE' });
      await refresh();
    } catch (err) {
      notify.error(translate(err));
    } finally {
      setBusy(false);
    }
  }

  const heading = <SectionHeading title={tb('title')} subtitle={tb('subtitle')} countLabel={status ? tConn('connectedCount', { count: status.connected ? 1 : 0 }) : undefined} />;

  if (loadError) {
    return (
      <section className="space-y-4">
        {heading}
        <p className="text-sm text-destructive">{loadError}</p>
      </section>
    );
  }
  if (!status) {
    return (
      <section className="space-y-4">
        {heading}
        <CardSkeleton />
      </section>
    );
  }

  const workspace = status.integration?.teamName ?? status.integration?.teamId ?? '';

  return (
    <section className="space-y-4">
      {heading}
      <CardGrid>
        <IntegrationCard
          vendor="slack"
          name="Slack"
          instance={status.connected ? workspace : undefined}
          category={tc('category.chatBridge')}
          description={tc('description.slack')}
          footer={
            !status.appConfigured ? (
              <span className="text-xs text-ink-mute">{t('notConfiguredShort')}</span>
            ) : !status.connected ? (
              <Button type="button" variant="outline" size="sm" className="whitespace-nowrap" onClick={connect} disabled={busy}>
                {tConn('connect')}
              </Button>
            ) : (
              <>
                <StatusPill tone="active" label={tConn('statusActive')} />
                <div className="flex gap-1.5">
                  <Button type="button" variant="outline" size="sm" className="whitespace-nowrap" onClick={() => setConfiguring(true)}>
                    {t('configure')}
                  </Button>
                  <Button type="button" variant="ghost" size="sm" className="whitespace-nowrap" onClick={() => void disconnect()} disabled={busy}>
                    {tConn('delete')}
                  </Button>
                </div>
              </>
            )
          }
        />
      </CardGrid>

      {configuring && (
        <SlackConfigureDialog
          status={status}
          onClose={() => setConfiguring(false)}
          onChanged={() => void refresh()}
        />
      )}
    </section>
  );
}

function SlackConfigureDialog({
  status,
  onClose,
  onChanged,
}: {
  status: SlackStatusDto;
  onClose: () => void;
  onChanged: () => void;
}) {
  const t = useTranslations('integrations.slack');
  const tCommon = useTranslations('common');
  const translate = useTranslateError();
  const defaultRoute = status.integration?.routes.find((r) => r.purpose === 'default');
  const [channelId, setChannelId] = useState(defaultRoute?.slackChannelId ?? '');
  const [botMissing, setBotMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  function saveRouting() {
    void run(async () => {
      const route = await api<SlackRouteDto & { botInChannel: boolean }>('/v1/slack/routing', {
        method: 'PUT',
        body: JSON.stringify({ slackChannelId: channelId.trim() }),
      });
      setBotMissing(!route.botInChannel);
      notify.success(t('routingSaved'));
      onChanged();
    });
  }

  function sendTest() {
    void run(async () => {
      await api('/v1/slack/test', { method: 'POST' });
      notify.success(t('testSent'));
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('configure')}</DialogTitle>
          <DialogDescription>
            {t('connectedTo', { workspace: status.integration?.teamName ?? status.integration?.teamId ?? '' })}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="slackChannelId">{t('channelLabel')}</Label>
            <Input id="slackChannelId" value={channelId} onChange={(e) => setChannelId(e.target.value)} placeholder="C0123456789" />
            <p className="text-xs text-muted-foreground">{t('channelHint')}</p>
          </div>
          {botMissing && <p className="text-sm text-amber-600">{t('inviteBot')}</p>}
          {status.deliveries.failedLastDay > 0 && (
            <p className="text-sm text-amber-600">{t('failedDeliveries', { count: status.deliveries.failedLastDay })}</p>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={sendTest} disabled={busy || !defaultRoute}>
            {t('sendTest')}
          </Button>
          <Button type="button" onClick={saveRouting} disabled={busy || channelId.trim().length === 0}>
            {busy ? tCommon('saving') : t('saveRouting')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
