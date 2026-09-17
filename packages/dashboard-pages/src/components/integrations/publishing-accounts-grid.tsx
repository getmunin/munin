'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenuItem,
  Input,
  Label,
  SectionHead,
} from '@getmunin/ui';
import { api } from '../../api';
import { authClient } from '../../auth-client';
import { notify } from '../../lib/notify';
import { useTranslateError } from '../../i18n/translate-error';
import { useConfirm } from '../confirm-dialog';
import { CardGridSkeleton } from '../skeleton';
import { CardGrid, CardMenu, StatusLine } from '../card-kit';
import { IntegrationCard } from './integration-card';
import { dialogLabelClass } from '../../lib/dialog-style';

interface SocialAccountDto {
  id: string;
  platform: string;
  userId: string;
  displayName: string | null;
  status: 'active' | 'expired' | 'revoked';
  canRefresh: boolean;
  expiresSoon: boolean;
  accessTokenExpiresAt: string | null;
}

interface SocialPlatformAppDto {
  platform: string;
  clientId: string;
  configured: boolean;
  redirectUri: string;
}

const PLATFORM_NAMES: Record<string, string> = { linkedin: 'LinkedIn' };

export function PublishingAccountsSection() {
  const t = useTranslations('integrations.publishing');
  const tc = useTranslations('integrations.catalog');
  const tConn = useTranslations('integrations.connectors');
  const tCommon = useTranslations('common');
  const translate = useTranslateError();
  const confirm = useConfirm();
  const { data: session } = authClient.useSession();
  const viewerId = session?.user?.id ?? null;

  const [apps, setApps] = useState<SocialPlatformAppDto[] | null>(null);
  const [accounts, setAccounts] = useState<SocialAccountDto[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [configuring, setConfiguring] = useState<SocialPlatformAppDto | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [appList, accountList] = await Promise.all([
        api<SocialPlatformAppDto[]>('/v1/social/accounts/apps'),
        api<SocialAccountDto[]>('/v1/social/accounts'),
      ]);
      setApps(appList);
      setAccounts(accountList);
      setLoadError(null);
    } catch (err) {
      setLoadError(translate(err));
    }
  }, [translate]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const outcome = params.get('social');
    if (!outcome) return;
    if (outcome === 'connected') notify.success(t('connected'));
    else if (outcome === 'denied') notify.error(t('denied'));
    else notify.error(t('failed'));
    params.delete('social');
    params.delete('platform');
    const query = params.toString();
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${query ? `?${query}` : ''}`,
    );
  }, [t]);

  function connect(platform: string) {
    setBusy(true);
    void (async () => {
      try {
        const res = await api<{ url: string }>('/v1/social/accounts/authorize-url', {
          method: 'POST',
          body: JSON.stringify({ platform }),
        });
        window.location.assign(res.url);
      } catch (err) {
        notify.error(translate(err));
        setBusy(false);
      }
    })();
  }

  async function disconnect(account: SocialAccountDto) {
    const ok = await confirm({
      title: t('disconnect'),
      message: t('disconnectConfirm', {
        platform: PLATFORM_NAMES[account.platform] ?? account.platform,
      }),
      confirmLabel: t('disconnect'),
      cancelLabel: tCommon('cancel'),
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api(`/v1/social/accounts/${account.id}`, { method: 'DELETE' });
      await refresh();
    } catch (err) {
      notify.error(translate(err));
    } finally {
      setBusy(false);
    }
  }

  const connectedCount = accounts?.length ?? 0;
  const heading = (
    <SectionHead
      title={t('title')}
      subtitle={t('subtitle')}
      actions={accounts ? tConn('connectedCount', { count: connectedCount }) : undefined}
    />
  );

  if (loadError) {
    return (
      <section className="space-y-4">
        {heading}
        <p className="text-sm text-destructive">{loadError}</p>
      </section>
    );
  }
  if (!apps || !accounts) {
    return (
      <section className="space-y-4">
        {heading}
        <CardGridSkeleton count={1} />
      </section>
    );
  }

  return (
    <section className="space-y-4">
      {heading}
      <CardGrid>
        {apps.map((app) => {
          const name = PLATFORM_NAMES[app.platform] ?? app.platform;
          const mine = accounts.find(
            (a) => a.platform === app.platform && a.userId === viewerId,
          );
          const others = accounts.filter(
            (a) => a.platform === app.platform && a.userId !== viewerId,
          ).length;
          return (
            <IntegrationCard
              key={app.platform}
              vendor={app.platform}
              name={name}
              instance={mine?.displayName ?? undefined}
              meta={
                !app.configured ? (
                  <StatusLine tone="inactive" label={t('appMissingShort')} />
                ) : !mine ? (
                  <StatusLine tone="inactive" label={t('notConnectedShort')} />
                ) : mine.status !== 'active' ? (
                  <StatusLine tone="error" label={t('statusLapsed')} />
                ) : mine.expiresSoon ? (
                  <StatusLine tone="pending" label={t('statusExpiringSoon')} />
                ) : (
                  <StatusLine tone="active" label={tConn('statusActive')} />
                )
              }
              description={tc('description.linkedin')}
              badge={others > 0 ? <ColleagueCount label={t('othersConnected', { count: others })} /> : undefined}
              menu={
                mine ? (
                  <CardMenu label={tConn('moreMenu')} disabled={busy}>
                    <DropdownMenuItem
                      variant="destructive"
                      disabled={busy}
                      onClick={() => void disconnect(mine)}
                    >
                      {t('disconnect')}
                    </DropdownMenuItem>
                  </CardMenu>
                ) : undefined
              }
              footer={
                <>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="whitespace-nowrap"
                    onClick={() => setConfiguring(app)}
                  >
                    {app.configured ? t('editApp') : t('setUpApp')}
                  </Button>
                  {app.configured && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="whitespace-nowrap"
                      onClick={() => connect(app.platform)}
                      disabled={busy}
                    >
                      {mine && mine.status !== 'active'
                        ? tConn('reconnect')
                        : mine
                          ? t('reauthorize')
                          : tConn('connect')}
                    </Button>
                  )}
                </>
              }
            />
          );
        })}
      </CardGrid>

      {configuring && (
        <PlatformAppDialog
          app={configuring}
          onClose={() => setConfiguring(null)}
          onSaved={() => {
            setConfiguring(null);
            void refresh();
          }}
        />
      )}
    </section>
  );
}

function ColleagueCount({ label }: { label: string }) {
  return <span className="text-[11px] text-ink-mute">{label}</span>;
}

function PlatformAppDialog({
  app,
  onClose,
  onSaved,
}: {
  app: SocialPlatformAppDto;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations('integrations.publishing');
  const tCommon = useTranslations('common');
  const translate = useTranslateError();
  const [clientId, setClientId] = useState(app.clientId);
  const [clientSecret, setClientSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = PLATFORM_NAMES[app.platform] ?? app.platform;

  function save() {
    setBusy(true);
    setError(null);
    void (async () => {
      try {
        await api('/v1/social/accounts/apps', {
          method: 'POST',
          body: JSON.stringify({
            platform: app.platform,
            clientId: clientId.trim(),
            clientSecret: clientSecret.trim(),
          }),
        });
        onSaved();
      } catch (err) {
        setError(translate(err));
      } finally {
        setBusy(false);
      }
    })();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('appDialogTitle', { platform: name })}</DialogTitle>
          <DialogDescription>{t('appDialogLede', { platform: name })}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <p className="border-l-[2px] border-rule-soft pl-3 text-xs text-muted-foreground dark:border-rule-on-dark">
            {t('appDialogAuthorNote', { platform: name })}
          </p>
          <div className="space-y-1.5">
            <Label className={dialogLabelClass} htmlFor="socialClientId">
              {t('clientId')}
            </Label>
            <Input
              id="socialClientId"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              autoComplete="off"
            />
          </div>
          <div className="space-y-1.5">
            <Label className={dialogLabelClass} htmlFor="socialClientSecret">
              {t('clientSecret')}
            </Label>
            <Input
              id="socialClientSecret"
              type="password"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">{t('clientSecretHint')}</p>
          </div>
          <p className="text-xs text-muted-foreground">
            {t('redirectHint', { url: app.redirectUri })}
          </p>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            {tCommon('cancel')}
          </Button>
          <Button
            type="button"
            onClick={save}
            disabled={busy || clientId.trim().length === 0 || clientSecret.trim().length === 0}
          >
            {busy ? tCommon('saving') : tCommon('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
