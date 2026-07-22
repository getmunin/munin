'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input, Label } from '@getmunin/ui';
import { api } from '../../api';
import { notify } from '../../lib/notify';
import { useTranslateError } from '../../i18n/translate-error';
import { useConfirm } from '../confirm-dialog';
import { CardSkeleton } from '../skeleton';
import { CardGrid, IntegrationCard, SectionHeading, StatusLine } from './integration-card';
import { NativeSelect } from '../native-select';
import { dialogLabelClass } from '../../lib/dialog-style';

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

interface SlackChannelOption {
  id: string;
  name: string | null;
  isMember: boolean;
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
          meta={
            !status.appConfigured ? (
              <StatusLine tone="inactive" label={t('notConfiguredShort')} />
            ) : status.connected ? (
              <StatusLine tone="active" label={tConn('statusActive')} />
            ) : undefined
          }
          description={tc('description.slack')}
          footer={
            !status.appConfigured ? (
              <Button type="button" variant="outline" size="sm" className="whitespace-nowrap" disabled>
                {tConn('connect')}
              </Button>
            ) : !status.connected ? (
              <Button type="button" variant="outline" size="sm" className="whitespace-nowrap" onClick={connect} disabled={busy}>
                {tConn('connect')}
              </Button>
            ) : (
              <>
                <Button type="button" variant="outline" size="sm" className="whitespace-nowrap" onClick={() => setConfiguring(true)}>
                  {t('configure')}
                </Button>
                <Button type="button" variant="ghost" size="sm" className="whitespace-nowrap" onClick={() => void disconnect()} disabled={busy}>
                  {tConn('delete')}
                </Button>
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
  const [channels, setChannels] = useState<SlackChannelOption[] | null>(null);
  const [channelsFailed, setChannelsFailed] = useState(false);
  const [botMissing, setBotMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await api<{ channels: SlackChannelOption[] }>('/v1/slack/channels');
        if (!cancelled) setChannels(res.channels.filter((c) => c.isMember));
      } catch {
        if (!cancelled) setChannelsFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
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

  function saveRouting() {
    void run(async () => {
      const route = await api<SlackRouteDto & { botInChannel: boolean }>('/v1/slack/routing', {
        method: 'PUT',
        body: JSON.stringify({ slackChannelId: channelId.trim() }),
      });
      onChanged();
      if (route.botInChannel) {
        onClose();
        return;
      }
      setBotMissing(true);
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
            <Label className={dialogLabelClass} htmlFor="slackChannelId">{t('channelLabel')}</Label>
            {channelsFailed ? (
              <>
                <Input id="slackChannelId" value={channelId} onChange={(e) => setChannelId(e.target.value)} placeholder="C0123456789" />
                <p className="text-xs text-muted-foreground">{t('channelsLoadFailed')}</p>
                <p className="text-xs text-muted-foreground">{t('channelHint')}</p>
              </>
            ) : channels !== null && channels.length === 0 && !channelId ? (
              <p className="text-sm text-muted-foreground">{t('channelsNoneInvited')}</p>
            ) : (
              <>
                <NativeSelect
                  id="slackChannelId"
                  value={channels === null ? '' : channelId}
                  onChange={(e) => setChannelId(e.target.value)}
                  disabled={channels === null}
                >
                  <option value="" disabled>
                    {channels === null ? t('channelsLoading') : t('channelSelectPlaceholder')}
                  </option>
                  {channelId && channels !== null && !channels.some((c) => c.id === channelId) && (
                    <option value={channelId}>
                      #{defaultRoute?.slackChannelName ?? channelId}
                    </option>
                  )}
                  {(channels ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      #{c.name ?? c.id}
                    </option>
                  ))}
                </NativeSelect>
                <p className="text-xs text-muted-foreground">{t('channelListHint')}</p>
              </>
            )}
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
