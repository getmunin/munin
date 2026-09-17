'use client';

import { useCallback, useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenuItem,
  DropdownMenuSeparator,
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
import { useCopy } from '../../lib/use-copy';

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
  clientSecretSetAt: string | null;
}

const PLATFORM_NAMES: Record<string, string> = { linkedin: 'LinkedIn' };

const PLATFORM_DEVELOPER_PORTALS: Record<string, string> = {
  linkedin: 'https://www.linkedin.com/developers/apps',
};

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
    const reason = params.get('reason');
    if (outcome === 'connected') notify.success(t('connected'));
    else if (outcome === 'denied') notify.error(t('denied'));
    else notify.error(reason ? t('failedWithReason', { reason }) : t('failed'));
    params.delete('social');
    params.delete('platform');
    params.delete('reason');
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
                app.configured ? (
                  <CardMenu label={tConn('moreMenu')} disabled={busy}>
                    <DropdownMenuItem disabled={busy} onClick={() => setConfiguring(app)}>
                      {t('editApp')}
                    </DropdownMenuItem>
                    {mine && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          disabled={busy}
                          onClick={() => void disconnect(mine)}
                        >
                          {t('disconnect')}
                        </DropdownMenuItem>
                      </>
                    )}
                  </CardMenu>
                ) : undefined
              }
              footer={
                app.configured ? (
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
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="whitespace-nowrap"
                    onClick={() => setConfiguring(app)}
                  >
                    {t('setUpApp')}
                  </Button>
                )
              }
            />
          );
        })}
      </CardGrid>

      {configuring && (
        <PlatformAppDialog
          app={configuring}
          connectedCount={
            accounts.filter((a) => a.platform === configuring.platform).length
          }
          onClose={() => setConfiguring(null)}
          onSaved={() => {
            setConfiguring(null);
            void refresh();
          }}
          onConnect={() => {
            setConfiguring(null);
            connect(configuring.platform);
          }}
        />
      )}
    </section>
  );
}

function ColleagueCount({ label }: { label: string }) {
  return <span className="text-[11px] text-ink-mute">{label}</span>;
}

function SetupStep({
  index,
  title,
  children,
}: {
  index: string;
  title: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex gap-4 border-t-[1px] border-rule-soft py-4 dark:border-rule-on-dark">
      <span className="flex-none pt-[1px] font-serif text-lg italic leading-none text-cobalt dark:text-cobalt-soft">
        {index}
      </span>
      <div className="min-w-0 flex-1 space-y-2">
        <p className="text-sm font-medium text-ink dark:text-foreground">{title}</p>
        {children}
      </div>
    </div>
  );
}

function ProductRow({ name, purpose }: { name: string; purpose: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b-[1px] border-rule-soft px-3 py-2 last:border-b-0 dark:border-rule-on-dark">
      <span className="text-[13px] text-ink dark:text-foreground">{name}</span>
      <span className="flex-none font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute">
        {purpose}
      </span>
    </div>
  );
}

function DialogEyebrow({ left, right }: { left: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute">
      <span>{left}</span>
      {right}
    </div>
  );
}

function FieldLabel({ htmlFor, children, aside }: { htmlFor: string; children: string; aside?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <Label className={dialogLabelClass} htmlFor={htmlFor}>
        {children}
      </Label>
      {aside && (
        <span className="font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute">
          {aside}
        </span>
      )}
    </div>
  );
}

function PlatformAppDialog({
  app,
  connectedCount,
  onClose,
  onSaved,
  onConnect,
}: {
  app: SocialPlatformAppDto;
  connectedCount: number;
  onClose: () => void;
  onSaved: () => void;
  onConnect: () => void;
}) {
  const t = useTranslations('integrations.publishing');
  const tCommon = useTranslations('common');
  const format = useFormatter();
  const translate = useTranslateError();
  const [view, setView] = useState<'setup' | 'credentials'>(
    app.configured ? 'credentials' : 'setup',
  );
  const [clientId, setClientId] = useState(app.clientId);
  const [clientSecret, setClientSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const redirectCopy = useCopy();
  const name = PLATFORM_NAMES[app.platform] ?? app.platform;
  const portalUrl = PLATFORM_DEVELOPER_PORTALS[app.platform];
  const editing = app.configured;
  const savedOn = app.clientSecretSetAt
    ? format.dateTime(new Date(app.clientSecretSetAt), { day: 'numeric', month: 'short' })
    : null;

  async function persist(): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      await api('/v1/social/accounts/apps', {
        method: 'POST',
        body: JSON.stringify({
          platform: app.platform,
          clientId: clientId.trim(),
          ...(clientSecret.trim().length > 0 ? { clientSecret: clientSecret.trim() } : {}),
        }),
      });
      return true;
    } catch (err) {
      setError(translate(err));
      return false;
    } finally {
      setBusy(false);
    }
  }

  const canSubmit =
    !busy && clientId.trim().length > 0 && (editing || clientSecret.trim().length > 0);

  if (view === 'setup') {
    return (
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogEyebrow left={editing ? t('eyebrowApp', { platform: name }) : t('eyebrowStepOne', { platform: name })} />
            <DialogTitle>{t('setupTitle', { platform: name })}</DialogTitle>
            <DialogDescription>{t('setupLede', { platform: name })}</DialogDescription>
          </DialogHeader>

          <div>
            <SetupStep
              index="01"
              title={t.rich('stepCreate', {
                portal: (chunks) =>
                  portalUrl ? (
                    <a
                      href={portalUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-cobalt underline underline-offset-2 dark:text-cobalt-soft"
                    >
                      {chunks}
                    </a>
                  ) : (
                    chunks
                  ),
              })}
            >
              <p className="text-xs text-ink-mute">{t('stepCreateNote', { platform: name })}</p>
            </SetupStep>

            <SetupStep index="02" title={t('stepProducts')}>
              <div className="border-[1px] border-rule-soft bg-paper-deep dark:border-rule-on-dark dark:bg-secondary">
                <ProductRow
                  name={t('productShare', { platform: name })}
                  purpose={t('productSharePurpose')}
                />
                <ProductRow
                  name={t('productSignIn', { platform: name })}
                  purpose={t('productSignInPurpose')}
                />
              </div>
              <p className="text-xs text-ink-mute">
                {t.rich('stepProductsNote', {
                  code: (chunks) => <code className="font-mono">{chunks}</code>,
                })}
              </p>
            </SetupStep>

            <SetupStep index="03" title={t('stepRedirect')}>
              <div className="flex items-stretch border-[1px] border-rule-soft bg-paper-deep dark:border-rule-on-dark dark:bg-secondary">
                <span className="min-w-0 flex-1 break-all px-3 py-2 font-mono text-xs text-ink dark:text-foreground">
                  {app.redirectUri}
                </span>
                <button
                  type="button"
                  onClick={() => redirectCopy.copy(app.redirectUri)}
                  className="flex-none border-l-[1px] border-rule-soft px-3 font-mono text-[10px] uppercase tracking-eyebrow text-cobalt dark:border-rule-on-dark dark:text-cobalt-soft"
                >
                  {redirectCopy.copied ? t('copied') : t('copy')}
                </button>
              </div>
            </SetupStep>
          </div>

          <DialogFooter className="items-end justify-between gap-4 border-t-[1px] border-rule-soft pt-4 dark:border-rule-on-dark">
            <p className="min-w-0 flex-1 text-left text-xs text-ink-mute">{t('setupStaysOpen')}</p>
            <div className="flex flex-none gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                {tCommon('cancel')}
              </Button>
              <Button type="button" onClick={() => setView('credentials')}>
                {editing ? t('backToCredentials') : t('doneNext')}
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
            left={editing ? t('eyebrowApp', { platform: name }) : t('eyebrowStepTwo', { platform: name })}
            right={
              editing ? (
                <span className="text-cobalt dark:text-cobalt-soft">
                  {t('eyebrowConnected', { count: connectedCount })}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setView('setup')}
                  className="font-mono uppercase tracking-eyebrow text-cobalt dark:text-cobalt-soft"
                >
                  {t('backToSteps')}
                </button>
              )
            }
          />
          <DialogTitle>
            {editing ? t('editTitle', { platform: name }) : t('credentialsTitle')}
          </DialogTitle>
          <DialogDescription>
            {editing ? t('editLede', { platform: name }) : t('credentialsLede')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <FieldLabel htmlFor="socialClientId">{t('clientId')}</FieldLabel>
            <Input
              id="socialClientId"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              autoComplete="off"
            />
          </div>
          <div className="space-y-1.5">
            <FieldLabel
              htmlFor="socialClientSecret"
              {...(editing && savedOn ? { aside: t('secretSavedOn', { date: savedOn }) } : {})}
            >
              {t('clientSecret')}
            </FieldLabel>
            <Input
              id="socialClientSecret"
              type="password"
              value={clientSecret}
              placeholder={editing ? t('secretStoredPlaceholder') : t('secretPlaceholder')}
              onChange={(e) => setClientSecret(e.target.value)}
              autoComplete="off"
            />
            <p className="text-xs text-ink-mute">
              {editing ? t('secretKeepHint') : t('clientSecretHint')}
            </p>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="border-t-[1px] border-rule-soft pt-4 dark:border-rule-on-dark">
            {editing ? (
              <p className="text-xs text-ink-mute">
                {t.rich('replacingApp', {
                  steps: (chunks) => (
                    <button
                      type="button"
                      onClick={() => setView('setup')}
                      className="text-cobalt underline underline-offset-2 dark:text-cobalt-soft"
                    >
                      {chunks}
                    </button>
                  ),
                })}
              </p>
            ) : (
              <p className="text-xs text-ink-mute">
                {t('appDialogAuthorNote', { platform: name })}
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => (editing ? onClose() : setView('setup'))}
            disabled={busy}
          >
            {editing ? tCommon('cancel') : t('back')}
          </Button>
          <Button
            type="button"
            disabled={!canSubmit}
            onClick={() => {
              void persist().then((ok) => {
                if (!ok) return;
                if (editing) onSaved();
                else onConnect();
              });
            }}
          >
            {busy ? tCommon('saving') : editing ? tCommon('save') : t('connect')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
