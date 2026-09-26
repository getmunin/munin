'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DropdownMenuItem, DropdownMenuSeparator, Input, Label } from '@getmunin/ui';
import { api } from '../../api';
import { notify } from '../../lib/notify';
import { useTranslateError } from '../../i18n/translate-error';
import { useConfirm } from '../confirm-dialog';
import { CardMenu, StatusLine } from '../card-kit';
import { IntegrationCard } from './integration-card';
import { NativeSelect } from '../native-select';
import { dialogLabelClass } from '../../lib/dialog-style';
import { CopyField, DialogEyebrow, PortalLink, SetupStep } from './setup-dialog-kit';

const TEAMS_BOT_PORTAL = 'https://dev.teams.microsoft.com/bots';
const ENTRA_OVERVIEW = 'https://entra.microsoft.com/';

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BOT_PAGE_URL = /\/tools\/bots\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

function botIdFromInput(value: string): string {
  return BOT_PAGE_URL.exec(value)?.[1] ?? value;
}

interface TeamsRouteDto {
  id: string;
  teamsChannelId: string;
  teamsChannelName: string | null;
  teamId: string | null;
  purpose: string;
}

export interface TeamsStatusDto {
  connected: boolean;
  messagingEndpoint: string;
  integration: {
    appId: string;
    credentialState: 'pending' | 'active';
    teams: { teamId: string; teamName: string | null; installed: boolean }[];
    routes: TeamsRouteDto[];
  } | null;
  deliveries: { pending: number; failedLastDay: number };
}

interface TeamsChannelOption {
  id: string;
  name: string;
  teamId: string;
  teamName: string | null;
}

interface CredentialLink {
  url: string;
  expiresAt: string;
}

function openPendingTab(): Window | null {
  const tab = window.open('', '_blank');
  if (tab) tab.opener = null;
  return tab;
}

function showCredentialLink(tab: Window | null, link: CredentialLink) {
  if (tab) tab.location.href = link.url;
  else window.location.assign(link.url);
}

async function downloadAppPackage() {
  const pkg = await api<{ filename: string; contentType: string; base64: string }>('/v1/teams/app-package');
  const bytes = Uint8Array.from(atob(pkg.base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: pkg.contentType }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = pkg.filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function TeamsBridgeCard({
  status,
  onChanged,
}: {
  status: TeamsStatusDto;
  onChanged: () => void;
}) {
  const t = useTranslations('integrations.teams');
  const tc = useTranslations('integrations.catalog');
  const tConn = useTranslations('integrations.connectors');
  const tCommon = useTranslations('common');
  const translate = useTranslateError();
  const confirm = useConfirm();
  const [connecting, setConnecting] = useState(false);
  const [configuring, setConfiguring] = useState(false);
  const [busy, setBusy] = useState(false);

  const integration = status.integration;
  const pending = integration?.credentialState === 'pending';
  const installedTeams = integration?.teams.filter((team) => team.installed) ?? [];
  const hasDefaultRoute = integration?.routes.some((r) => r.purpose === 'default') ?? false;
  const instance = installedTeams.map((team) => team.teamName ?? team.teamId).join(', ');

  async function withBusy(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      notify.error(translate(err));
    } finally {
      setBusy(false);
    }
  }

  function enterSecret() {
    const tab = openPendingTab();
    void withBusy(async () => {
      try {
        showCredentialLink(tab, await api<CredentialLink>('/v1/teams/credentials-link', { method: 'POST' }));
      } catch (err) {
        tab?.close();
        throw err;
      }
    });
  }

  function sendTest() {
    void withBusy(async () => {
      await api('/v1/teams/test', { method: 'POST' });
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
    await withBusy(async () => {
      await api('/v1/teams', { method: 'DELETE' });
      onChanged();
    });
  }

  const meta = !integration ? undefined : pending ? (
    <StatusLine tone="inactive" label={t('secretNeeded')} />
  ) : installedTeams.length === 0 ? (
    <StatusLine tone="inactive" label={t('noTeamYet')} />
  ) : (
    <StatusLine tone="active" label={tConn('statusActive')} />
  );

  return (
    <>
      <IntegrationCard
        vendor="teams"
        name={t('title')}
        instance={status.connected && instance ? instance : undefined}
        meta={meta}
        description={tc('description.teams')}
        menu={
          integration ? (
            <CardMenu label={tConn('moreMenu')} disabled={busy}>
              {!pending && (
                <DropdownMenuItem disabled={busy || !hasDefaultRoute} onClick={sendTest}>
                  {t('sendTest')}
                </DropdownMenuItem>
              )}
              {!pending && (
                <DropdownMenuItem disabled={busy} onClick={enterSecret}>
                  {t('enterSecret')}
                </DropdownMenuItem>
              )}
              {!pending && <DropdownMenuSeparator />}
              <DropdownMenuItem variant="destructive" disabled={busy} onClick={() => void disconnect()}>
                {tConn('delete')}
              </DropdownMenuItem>
            </CardMenu>
          ) : undefined
        }
        footer={
          !integration ? (
            <Button type="button" variant="outline" size="sm" className="whitespace-nowrap" onClick={() => setConnecting(true)}>
              {tConn('connect')}
            </Button>
          ) : pending ? (
            <Button type="button" variant="outline" size="sm" className="whitespace-nowrap" onClick={enterSecret} disabled={busy}>
              {t('enterSecret')}
            </Button>
          ) : (
            <Button type="button" variant="outline" size="sm" className="whitespace-nowrap" onClick={() => setConfiguring(true)}>
              {t('configure')}
            </Button>
          )
        }
      />
      {connecting && (
        <TeamsConnectDialog
          messagingEndpoint={status.messagingEndpoint}
          onClose={() => setConnecting(false)}
          onConnected={() => {
            setConnecting(false);
            onChanged();
            setConfiguring(true);
          }}
        />
      )}
      {configuring && (
        <TeamsConfigureDialog status={status} onClose={() => setConfiguring(false)} onChanged={onChanged} />
      )}
    </>
  );
}

function TeamsConnectDialog({
  messagingEndpoint,
  onClose,
  onConnected,
}: {
  messagingEndpoint: string;
  onClose: () => void;
  onConnected: () => void;
}) {
  const t = useTranslations('integrations.teams');
  const tCommon = useTranslations('common');
  const translate = useTranslateError();
  const [view, setView] = useState<'setup' | 'credentials'>('setup');
  const [appId, setAppId] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const em = (chunks: React.ReactNode) => <em className="not-italic text-ink dark:text-foreground">{chunks}</em>;

  const appIdValid = GUID.test(appId.trim());
  const tenantIdValid = GUID.test(tenantId.trim());
  const canSubmit = !busy && appIdValid && tenantIdValid && appSecret.trim().length > 0;

  function submit() {
    setBusy(true);
    setError(null);
    void (async () => {
      try {
        await api('/v1/teams/connection', {
          method: 'POST',
          body: JSON.stringify({ appId: appId.trim(), tenantId: tenantId.trim(), appSecret: appSecret.trim() }),
        });
        notify.success(t('created'));
        onConnected();
      } catch (err) {
        setError(translate(err));
        setBusy(false);
      }
    })();
  }

  if (view === 'setup') {
    return (
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogEyebrow left={t('eyebrowStepOne')} />
            <DialogTitle>{t('setupTitle')}</DialogTitle>
            <DialogDescription>{t('setupLede')}</DialogDescription>
          </DialogHeader>

          <div>
            <SetupStep
              index="01"
              title={t.rich('stepCreate', {
                portal: (chunks) => <PortalLink href={TEAMS_BOT_PORTAL}>{chunks}</PortalLink>,
              })}
            >
              <p className="text-xs text-ink-mute">{t.rich('stepCreateNote', { em })}</p>
            </SetupStep>

            <SetupStep index="02" title={t.rich('stepEndpoint', { em })}>
              <CopyField value={messagingEndpoint} copyLabel={t('copy')} copiedLabel={t('copied')} />
            </SetupStep>

            <SetupStep index="03" title={t.rich('stepSecret', { em })}>
              <p className="text-xs text-ink-mute">{t('stepSecretNote')}</p>
            </SetupStep>
          </div>

          <DialogFooter className="items-end justify-between gap-4 border-t-[1px] border-rule-soft pt-4 dark:border-rule-on-dark">
            <p className="min-w-0 flex-1 text-left text-xs text-ink-mute">{t('setupStaysOpen')}</p>
            <div className="flex flex-none gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                {tCommon('cancel')}
              </Button>
              <Button type="button" onClick={() => setView('credentials')}>
                {t('doneNext')}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogEyebrow
            left={t('eyebrowStepTwo')}
            right={
              <button
                type="button"
                onClick={() => setView('setup')}
                className="font-mono uppercase tracking-eyebrow text-cobalt dark:text-cobalt-soft"
              >
                {t('backToSteps')}
              </button>
            }
          />
          <DialogTitle>{t('credentialsTitle')}</DialogTitle>
          <DialogDescription>{t('credentialsLede')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className={dialogLabelClass} htmlFor="teamsAppId">{t('appIdLabel')}</Label>
            <Input
              id="teamsAppId"
              value={appId}
              onChange={(e) => setAppId(botIdFromInput(e.target.value))}
              placeholder="00000000-0000-0000-0000-000000000000"
              autoComplete="off"
            />
            <p className="text-xs text-ink-mute">{appId && !appIdValid ? t('invalidGuid') : t('appIdHint')}</p>
          </div>
          <div className="space-y-1.5">
            <Label className={dialogLabelClass} htmlFor="teamsTenantId">{t('tenantIdLabel')}</Label>
            <Input
              id="teamsTenantId"
              value={tenantId}
              onChange={(e) => setTenantId(e.target.value)}
              placeholder="00000000-0000-0000-0000-000000000000"
              autoComplete="off"
            />
            <p className="text-xs text-ink-mute">
              {tenantId && !tenantIdValid
                ? t('invalidGuid')
                : t.rich('tenantIdHint', {
                    entra: (chunks) => <PortalLink href={ENTRA_OVERVIEW}>{chunks}</PortalLink>,
                  })}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label className={dialogLabelClass} htmlFor="teamsAppSecret">{t('secretLabel')}</Label>
            <Input
              id="teamsAppSecret"
              type="password"
              value={appSecret}
              onChange={(e) => setAppSecret(e.target.value)}
              autoComplete="off"
            />
            <p className="text-xs text-ink-mute">{t('secretHint')}</p>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setView('setup')} disabled={busy}>
            {t('back')}
          </Button>
          <Button type="button" onClick={submit} disabled={!canSubmit}>
            {busy ? t('connecting') : t('create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TeamsConfigureDialog({
  status,
  onClose,
  onChanged,
}: {
  status: TeamsStatusDto;
  onClose: () => void;
  onChanged: () => void;
}) {
  const t = useTranslations('integrations.teams');
  const tCommon = useTranslations('common');
  const translate = useTranslateError();
  const defaultRoute = status.integration?.routes.find((r) => r.purpose === 'default');
  const [channelId, setChannelId] = useState(defaultRoute?.teamsChannelId ?? '');
  const [channels, setChannels] = useState<TeamsChannelOption[] | null>(null);
  const [channelsError, setChannelsError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const em = (chunks: React.ReactNode) => <em className="not-italic text-ink dark:text-foreground">{chunks}</em>;

  useEffect(() => {
    let cancelled = false;
    setChannels(null);
    setChannelsError(null);
    void (async () => {
      try {
        const res = await api<{ channels: TeamsChannelOption[] }>('/v1/teams/channels');
        if (!cancelled) setChannels(res.channels);
      } catch (err) {
        if (!cancelled) setChannelsError(translate(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [translate, reloadKey]);

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
      await api<TeamsRouteDto>('/v1/teams/routing', {
        method: 'PUT',
        body: JSON.stringify({ teamsChannelId: channelId }),
      });
      onChanged();
      onClose();
    });
  }

  const checkAgain = (
    <button
      type="button"
      onClick={() => {
        onChanged();
        setReloadKey((k) => k + 1);
      }}
      className="font-mono text-[10px] uppercase tracking-eyebrow text-cobalt dark:text-cobalt-soft"
    >
      {t('checkAgain')}
    </button>
  );

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogEyebrow left={t('eyebrowApp')} />
          <DialogTitle>{t('configureTitle')}</DialogTitle>
          <DialogDescription>{t('configureLede')}</DialogDescription>
        </DialogHeader>

        <div>
          <SetupStep index="01" title={t('stepDownload')}>
            <Button type="button" variant="outline" size="sm" onClick={() => void run(downloadAppPackage)} disabled={busy}>
              {t('downloadPackage')}
            </Button>
          </SetupStep>

          <SetupStep index="02" title={t.rich('stepUpload', { em })}>
            <p className="text-xs text-ink-mute">{t('stepUploadNote')}</p>
          </SetupStep>

          <SetupStep index="03" title={t('stepChannel')}>
            {channelsError ? (
              <>
                <p className="text-sm text-destructive">{t('channelsLoadFailed')}</p>
                <p className="text-xs text-ink-mute">{channelsError}</p>
                {checkAgain}
              </>
            ) : channels !== null && channels.length === 0 ? (
              <>
                <p className="text-xs text-ink-mute">{t('channelsNone')}</p>
                {checkAgain}
              </>
            ) : (
              <NativeSelect
                id="teamsChannelId"
                aria-label={t('channelLabel')}
                value={channels === null ? '' : channelId}
                onChange={(e) => setChannelId(e.target.value)}
                disabled={channels === null}
              >
                <option value="" disabled>
                  {channels === null ? t('channelsLoading') : t('channelSelectPlaceholder')}
                </option>
                {(channels ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.teamName ?? c.teamId} › {c.name}
                  </option>
                ))}
              </NativeSelect>
            )}
          </SetupStep>
        </div>

        {status.deliveries.failedLastDay > 0 && (
          <p className="text-sm text-amber-600">{t('failedDeliveries', { count: status.deliveries.failedLastDay })}</p>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            {tCommon('cancel')}
          </Button>
          <Button type="button" onClick={saveRouting} disabled={busy || channelId.length === 0}>
            {busy ? tCommon('saving') : t('saveRouting')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
