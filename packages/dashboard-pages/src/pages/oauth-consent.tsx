'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { PageSpinner } from '@getmunin/ui';
import { authClient } from '../auth-client';
import { authorizationExpiresAt } from '../auth/authorization-expiry';
import { checkConsentOrgBinding, type ConsentOrgBinding } from '../auth/consent-org-binding';
import { api, ApiError } from '../api';
import { useTranslateError } from '../i18n/translate-error';
import {
  countConsentScopes,
  groupConsentScopes,
  type ConsentScopeGroup,
} from '../auth/consent-scopes';
import { resolveConsentIdentity, type ConsentIdentity } from '../auth/consent-identity';

export interface OAuthClientInfo {
  client_id: string;
  name: string | null;
  uri: string | null;
  icon_url: string;
  redirect_uri_host: string | null;
  impersonates?: string | null;
  created_at: string;
}

export interface OAuthResourcePermission {
  key: string;
  label: string;
  description?: string;
  level: 'read' | 'write';
}

export interface OAuthResourceInfo {
  id: string;
  name: string;
  permissions: OAuthResourcePermission[];
}

export interface OAuthConsentDenial {
  reason: 'not_eligible' | 'no_org';
  resourceName: string;
}

export interface OAuthConsentPageProps {
  clientInfo: OAuthClientInfo | null;
  resourceInfo?: OAuthResourceInfo | null;
  denial?: OAuthConsentDenial | null;
}

interface OAuthConsentResponse {
  url?: string;
  redirect_uri?: string;
}

type FlowState = 'new' | 'granted' | 'denied';
type HeaderState = FlowState | 'blocked' | 'expired' | 'wrongAccount';

const REDIRECT_DELAY_MS = 1200;

export function OAuthConsentPage({
  clientInfo,
  resourceInfo = null,
  denial = null,
}: OAuthConsentPageProps) {
  const t = useTranslations('dashboard.oauthConsent');
  const translate = useTranslateError();
  const search = useSearchParams();
  const { data: session, isPending } = authClient.useSession();

  const clientId = search?.get('client_id') ?? clientInfo?.client_id ?? '';
  const scopeRaw = search?.get('scope') ?? '';
  const oauthQuery = useMemo(() => {
    if (typeof window === 'undefined') return '';
    return window.location.search.replace(/^\?/, '');
  }, []);

  const scopes = useMemo(
    () => (scopeRaw ? scopeRaw.split(/\s+/).filter(Boolean) : []),
    [scopeRaw],
  );
  const groupedScopes = useMemo(() => groupConsentScopes(scopes), [scopes]);
  const totalScopeCount = useMemo(() => countConsentScopes(groupedScopes), [groupedScopes]);

  const [flow, setFlow] = useState<FlowState>('new');
  const [busy, setBusy] = useState<'allow' | 'deny' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);
  const [binding, setBinding] = useState<ConsentOrgBinding | null>(null);
  const codeChallenge = search?.get('code_challenge') ?? '';
  const sessionUserId = session?.user?.id ?? null;

  const expiresAtMs = authorizationExpiresAt(search?.get('exp'));
  const [expired, setExpired] = useState(() => expiresAtMs !== null && expiresAtMs <= Date.now());

  useEffect(() => {
    if (expiresAtMs === null || expired) return;
    const id = window.setTimeout(() => setExpired(true), Math.max(expiresAtMs - Date.now(), 0));
    return () => window.clearTimeout(id);
  }, [expiresAtMs, expired]);

  useEffect(() => {
    if (!isPending && !session) {
      window.location.assign(oauthQuery ? `/login?${oauthQuery}` : '/login');
    }
  }, [isPending, session, oauthQuery]);

  useEffect(() => {
    if (!sessionUserId) return;
    let cancelled = false;
    setBinding(null);
    void checkConsentOrgBinding(codeChallenge).then((result) => {
      if (!cancelled) setBinding(result);
    });
    return () => {
      cancelled = true;
    };
  }, [sessionUserId, codeChallenge]);

  if (isPending || !session || !binding) {
    return <PageSpinner className="min-h-screen bg-background" />;
  }

  if (!clientId || !oauthQuery) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center bg-bone px-6 dark:bg-background">
        <div className="max-w-md border-[1px] border-ink bg-paper p-6 text-sm text-destructive dark:border-rule-on-dark dark:bg-card">
          {t('missingParams')}
        </div>
      </div>
    );
  }

  const identity = resolveConsentIdentity({
    clientId,
    clientName: clientInfo?.name,
    impersonates: clientInfo?.impersonates,
    registeredRedirectHost: clientInfo?.redirect_uri_host,
    requestedRedirectUri: search?.get('redirect_uri'),
  });
  const displayName = identity.displayName;
  const userName = session.user?.name?.trim() || session.user?.email || '';
  const redirectHost = identity.redirectHost ?? '';

  async function submit(accept: boolean) {
    setBusy(accept ? 'allow' : 'deny');
    setError(null);
    try {
      const resp = await api<OAuthConsentResponse>('/auth/oauth2/consent', {
        method: 'POST',
        body: JSON.stringify({ accept, oauth_query: oauthQuery }),
      });
      const target = resp?.url ?? resp?.redirect_uri;
      setFlow(accept ? 'granted' : 'denied');
      if (target) {
        window.setTimeout(() => window.location.assign(target), REDIRECT_DELAY_MS);
      }
    } catch (err) {
      if (err instanceof ApiError) setError(translate(err) || err.message);
      else setError(t('errors.generic'));
      setBusy(null);
    }
  }

  function switchAccount() {
    setSwitching(true);
    void (async () => {
      await authClient.signOut();
      window.location.assign(oauthQuery ? `/login?${oauthQuery}` : '/login');
    })();
  }

  const stale = flow === 'new' && expired;
  const foreignOrgId = binding.status === 'foreign' ? binding.orgId : null;
  const wrongAccount = flow === 'new' && !stale && foreignOrgId !== null;
  const blocked = flow === 'new' && !stale && !wrongAccount && denial !== null;
  const resourceName = denial?.resourceName ?? resourceInfo?.name ?? '';

  return (
    <div className="bg-background">
      <main className="mx-auto flex w-full max-w-[720px] flex-col px-6 py-12 sm:py-16">
        <EditorialHeader
          flow={stale ? 'expired' : wrongAccount ? 'wrongAccount' : blocked ? 'blocked' : flow}
          clientName={displayName}
          userName={userName}
          resourceName={resourceName}
        />

        <section className="mt-8 border-[1px] border-ink bg-paper dark:border-rule-on-dark dark:bg-card">
          {stale ? (
            <ExpiredPane clientInfo={clientInfo} identity={identity} />
          ) : wrongAccount ? (
            <WrongAccountPane
              clientInfo={clientInfo}
              identity={identity}
              userName={userName}
              orgId={foreignOrgId}
              busy={busy}
              switching={switching}
              error={error}
              onSwitchAccount={switchAccount}
              onCancel={() => void submit(false)}
            />
          ) : blocked ? (
            <BlockedPane
              clientInfo={clientInfo}
              identity={identity}
              denial={denial}
              busy={busy}
              error={error}
              onCancel={() => void submit(false)}
            />
          ) : flow === 'new' ? (
            <RequestPane
              clientInfo={clientInfo}
              identity={identity}
              userName={userName}
              resourceInfo={resourceInfo}
              groupedScopes={groupedScopes}
              totalScopeCount={totalScopeCount}
              busy={busy}
              error={error}
              onSubmit={(accept) => void submit(accept)}
              onSwitchAccount={switchAccount}
            />
          ) : (
            <ResultPane
              flow={flow}
              displayName={displayName}
              redirectHost={redirectHost}
            />
          )}
        </section>
      </main>
    </div>
  );
}

interface EditorialHeaderProps {
  flow: HeaderState;
  clientName: string;
  userName: string;
  resourceName: string;
}

function EditorialHeader({ flow, clientName, userName, resourceName }: EditorialHeaderProps) {
  const t = useTranslations('dashboard.oauthConsent');
  if (flow === 'wrongAccount') {
    return (
      <header className="mb-6">
        <div className="mb-4 font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-ink-mute">
          {t('wrongAccount.eyebrow')}
        </div>
        <h1 className="font-serif text-[clamp(46px,6.6vw,72px)] font-normal leading-[0.98] tracking-[-0.02em] min-w-0 [overflow-wrap:anywhere] [word-break:break-word]">
          {t.rich('wrongAccount.title', { em: (chunks) => <em className="not-italic text-ink italic dark:text-foreground">{chunks}</em> })}
        </h1>
        <p className="mt-4 max-w-[54ch] text-base leading-relaxed text-ink-soft [overflow-wrap:anywhere] dark:text-foreground/80">
          {t.rich('wrongAccount.sub', {
            client: () => <em className="not-italic font-medium text-ink italic dark:text-foreground">{clientName}</em>,
            user: () => <em className="not-italic font-medium text-ink italic dark:text-foreground">{userName || '…'}</em>,
          })}
        </p>
      </header>
    );
  }
  if (flow === 'expired') {
    return (
      <header className="mb-6">
        <div className="mb-4 font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-ink-mute">
          {t('expired.eyebrow')}
        </div>
        <h1 className="font-serif text-[clamp(46px,6.6vw,72px)] font-normal leading-[0.98] tracking-[-0.02em] min-w-0 [overflow-wrap:anywhere] [word-break:break-word]">
          {t.rich('expired.title', { em: (chunks) => <em className="not-italic text-ink italic dark:text-foreground">{chunks}</em> })}
        </h1>
        <p className="mt-4 max-w-[54ch] text-base leading-relaxed text-ink-soft [overflow-wrap:anywhere] dark:text-foreground/80">
          {t.rich('expired.sub', {
            client: () => <em className="not-italic font-medium text-ink italic dark:text-foreground">{clientName}</em>,
          })}
        </p>
      </header>
    );
  }
  if (flow === 'blocked') {
    return (
      <header className="mb-6">
        <div className="mb-4 font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-ink-mute">
          {t('blocked.eyebrow')}
        </div>
        <h1 className="font-serif text-[clamp(46px,6.6vw,72px)] font-normal leading-[0.98] tracking-[-0.02em] min-w-0 [overflow-wrap:anywhere] [word-break:break-word]">
          {t.rich('blocked.title', { em: (chunks) => <em className="not-italic text-ink italic dark:text-foreground">{chunks}</em> })}
        </h1>
        <p className="mt-4 max-w-[54ch] text-base leading-relaxed text-ink-soft [overflow-wrap:anywhere] dark:text-foreground/80">
          {t.rich('blocked.sub', {
            client: () => <em className="not-italic font-medium text-ink italic dark:text-foreground">{clientName}</em>,
            resource: () => <em className="not-italic font-medium text-ink italic dark:text-foreground">{resourceName}</em>,
          })}
        </p>
      </header>
    );
  }
  if (flow === 'granted') {
    return (
      <header className="mb-6">
        <div className="mb-4 flex items-center gap-2 font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-ink-mute">
          <span className="text-cobalt dark:text-cobalt-soft">✓</span>
          <span>{t('granted.eyebrow')}</span>
        </div>
        <h1 className="font-serif text-[clamp(46px,6.6vw,72px)] font-normal leading-[0.98] tracking-[-0.02em] min-w-0 [overflow-wrap:anywhere] [word-break:break-word]">
          {t.rich('granted.title', { em: (chunks) => <em className="not-italic text-cobalt italic dark:text-cobalt-soft">{chunks}</em> })}
        </h1>
        <p className="mt-4 max-w-[54ch] text-base leading-relaxed text-ink-soft [overflow-wrap:anywhere] dark:text-foreground/80">
          {t.rich('granted.sub', {
            client: () => <em className="not-italic font-medium text-ink italic dark:text-foreground">{clientName}</em>,
            strong: (chunks) => <strong className="font-medium text-ink dark:text-foreground">{chunks}</strong>,
          })}
        </p>
      </header>
    );
  }
  if (flow === 'denied') {
    return (
      <header className="mb-6">
        <div className="mb-4 font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-ink-mute">
          {t('denied.eyebrow')}
        </div>
        <h1 className="font-serif text-[clamp(46px,6.6vw,72px)] font-normal leading-[0.98] tracking-[-0.02em] min-w-0 [overflow-wrap:anywhere] [word-break:break-word]">
          {t.rich('denied.title', { em: (chunks) => <em className="not-italic text-ink italic dark:text-foreground">{chunks}</em> })}
        </h1>
        <p className="mt-4 max-w-[54ch] text-base leading-relaxed text-ink-soft [overflow-wrap:anywhere] dark:text-foreground/80">
          {t.rich('denied.sub', {
            client: () => <em className="not-italic font-medium text-ink italic dark:text-foreground">{clientName}</em>,
            strong: (chunks) => <strong className="font-medium text-ink dark:text-foreground">{chunks}</strong>,
          })}
        </p>
      </header>
    );
  }
  return (
    <header className="mb-6">
      <div className="mb-4 font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-ink-mute">
        {t('eyebrow')}
      </div>
      <h1 className="font-serif text-[clamp(46px,6.6vw,72px)] font-normal leading-[0.98] tracking-[-0.02em] min-w-0 [overflow-wrap:anywhere] [word-break:break-word]">
        {t.rich('title', { client: () => <em className="not-italic text-cobalt italic dark:text-cobalt-soft">{clientName}</em> })}
      </h1>
      <p className="mt-4 max-w-[54ch] text-base leading-relaxed text-ink-soft dark:text-foreground/80">
        {t.rich(resourceName ? 'resourceLede' : 'lede', {
          client: () => <em className="not-italic font-medium text-ink italic dark:text-foreground">{clientName}</em>,
          resource: () => <em className="not-italic font-medium text-ink italic dark:text-foreground">{resourceName}</em>,
        })}
      </p>
    </header>
  );
}

interface RequestPaneProps {
  clientInfo: OAuthClientInfo | null;
  identity: ConsentIdentity;
  userName: string;
  resourceInfo: OAuthResourceInfo | null;
  groupedScopes: ConsentScopeGroup[];
  totalScopeCount: number;
  busy: 'allow' | 'deny' | null;
  error: string | null;
  onSubmit: (accept: boolean) => void;
  onSwitchAccount: () => void;
}

function RequestPane({
  clientInfo,
  identity,
  userName,
  resourceInfo,
  groupedScopes,
  totalScopeCount,
  busy,
  error,
  onSubmit,
  onSwitchAccount,
}: RequestPaneProps) {
  const t = useTranslations('dashboard.oauthConsent');
  const permissions = resourceInfo?.permissions ?? null;
  const displayName = identity.displayName;
  return (
    <>
      <IdentityCard clientInfo={clientInfo} identity={identity} />
      {identity.impersonates && (
        <ImpersonationWarning product={identity.impersonates} host={identity.redirectHost} />
      )}
      <TrustTimeline clientName={displayName} />

      <div className="px-7 pt-2 pb-1">
        <div className="flex items-baseline justify-between py-4">
          <span className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-ink-mute">
            {t('scopesLabel')}
          </span>
          <span className="font-mono text-[11px] text-ink-soft dark:text-foreground/80">
            {permissions
              ? t('resourceScopesCount', { scopes: permissions.length })
              : t('scopesCount', { modules: groupedScopes.length, scopes: totalScopeCount })}
          </span>
        </div>

        {permissions ? (
          permissions.length === 0 ? (
            <p className="pb-4 text-sm text-ink-soft dark:text-foreground/80">{t('noResourcePermissions')}</p>
          ) : (
            <ul className="border-t-[1px] border-rule-soft dark:border-rule-on-dark">
              {permissions.map((permission) => (
                <ResourcePermissionRow key={permission.key} permission={permission} />
              ))}
            </ul>
          )
        ) : groupedScopes.length === 0 ? (
          <p className="pb-4 text-sm text-ink-soft dark:text-foreground/80">{t('noModuleScopes')}</p>
        ) : (
          <ul className="border-t-[1px] border-rule-soft dark:border-rule-on-dark">
            {groupedScopes.map((g) => (
              <PermissionRow key={g.module} group={g} />
            ))}
          </ul>
        )}
      </div>

      <ReassuranceBlock displayName={displayName} userName={userName} />

      {error && (
        <p className="px-7 pb-3 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      <ActionsFooter
        userName={userName}
        busy={busy}
        onAuthorize={() => onSubmit(true)}
        onDeny={() => onSubmit(false)}
        onSwitchAccount={onSwitchAccount}
      />
    </>
  );
}

interface IdentityCardProps {
  clientInfo: OAuthClientInfo | null;
  identity: ConsentIdentity;
}

function IdentityCard({ clientInfo, identity }: IdentityCardProps) {
  const t = useTranslations('dashboard.oauthConsent');
  const { displayName, redirectHost } = identity;
  const firstChar = displayName.slice(0, 1).toUpperCase();
  const registeredLabel = formatRegistered(clientInfo?.created_at);
  return (
    <div
      className={`flex gap-4 border-b-[1px] border-rule-soft px-7 py-5 dark:border-rule-on-dark ${
        registeredLabel || redirectHost ? 'items-start' : 'items-center'
      }`}
    >
      <div className="flex h-[50px] w-[50px] shrink-0 items-center justify-center overflow-hidden rounded-xl border-[1px] border-ink bg-white font-serif text-[28px] leading-none text-ink dark:border-rule-on-dark">
        {identity.showClientIcon && clientInfo?.icon_url ? (
          <img
            src={clientInfo.icon_url}
            alt=""
            className="h-9 w-9 object-contain"
            onError={(e) => {
              (e.currentTarget).style.display = 'none';
            }}
          />
        ) : (
          <span>{firstChar}</span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 font-serif text-[26px] leading-tight tracking-[-0.01em] [overflow-wrap:anywhere]">
            {displayName}
          </span>
        </div>
        {redirectHost && (
          <div className="mt-0.5 text-[13px] leading-snug text-ink-soft [overflow-wrap:anywhere] dark:text-foreground/80">
            {t.rich('redirectsTo', {
              host: () => (
                <span className="font-mono text-[12.5px] font-medium text-ink dark:text-foreground">
                  {redirectHost}
                </span>
              ),
            })}
          </div>
        )}
        {registeredLabel && (
          <div className="font-mono text-[11px] tracking-[0.02em] text-ink-mute">
            {t('registered', { date: registeredLabel })}
          </div>
        )}
      </div>
    </div>
  );
}

function ImpersonationWarning({ product, host }: { product: string; host: string | null }) {
  const t = useTranslations('dashboard.oauthConsent');
  return (
    <div
      role="alert"
      className="mx-7 mt-4 border-[1px] border-destructive/40 bg-destructive/5 px-4 py-3.5 text-[13px] leading-relaxed text-ink-soft [overflow-wrap:anywhere] dark:bg-destructive/10 dark:text-foreground/80"
    >
      <b className="font-semibold text-destructive">{t('impersonation.lead')}</b>{' '}
      {t.rich(host ? 'impersonation.body' : 'impersonation.bodyNoHost', {
        product: () => <b className="font-semibold text-ink dark:text-foreground">{product}</b>,
        host: () => <span className="font-mono text-[12.5px] font-medium text-ink dark:text-foreground">{host}</span>,
      })}
    </div>
  );
}

function formatRegistered(iso: string | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long' });
}

function TrustTimeline({ clientName }: { clientName: string }) {
  const t = useTranslations('dashboard.oauthConsent');
  return (
    <div className="flex items-center gap-3 border-b-[1px] border-rule-soft bg-paper px-7 py-3 text-[13px] leading-snug text-ink-soft dark:border-rule-on-dark dark:bg-card dark:text-foreground/80">
      <span className="text-ink-mute">
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 8v4l3 2" />
        </svg>
      </span>
      <span className="min-w-0 [overflow-wrap:anywhere]">
        {t.rich('trustFirst', {
          client: () => <strong className="font-semibold text-ink dark:text-foreground">{clientName}</strong>,
        })}
      </span>
    </div>
  );
}

function PermissionRow({ group }: { group: ConsentScopeGroup }) {
  const t = useTranslations('dashboard.oauthConsent');
  const descriptionKey = group.write
    ? `moduleDescriptions.${group.module}.readWrite`
    : `moduleDescriptions.${group.module}.read`;
  const title = group.described ? t(`modules.${group.module}`) : group.module;
  const description = group.described
    ? t(descriptionKey)
    : t('undescribedScopes', { scopes: group.scopes.join(', ') });
  return (
    <li className="grid grid-cols-[1fr_auto] items-center gap-x-4 border-t-[1px] border-rule-soft py-3.5 first:border-t-0 dark:border-rule-on-dark">
      <div className="min-w-0">
        <div className="text-[15px] font-semibold text-ink [overflow-wrap:anywhere] dark:text-foreground">{title}</div>
        <div className="mt-1 text-[13px] leading-snug text-ink-soft [overflow-wrap:anywhere] dark:text-foreground/80">
          {description}
        </div>
      </div>
      <div className="inline-flex shrink-0 items-center gap-1.5">
        {group.read && <ScopePill kind="read" label={t('actions.read')} />}
        {group.write && <ScopePill kind="write" label={t('actions.write')} />}
      </div>
    </li>
  );
}

function ResourcePermissionRow({ permission }: { permission: OAuthResourcePermission }) {
  const t = useTranslations('dashboard.oauthConsent');
  return (
    <li className="grid grid-cols-[1fr_auto] items-center gap-x-4 border-t-[1px] border-rule-soft py-3.5 first:border-t-0 dark:border-rule-on-dark">
      <div className="min-w-0">
        <div className="text-[15px] font-semibold text-ink dark:text-foreground">{permission.label}</div>
        {permission.description && (
          <div className="mt-1 text-[13px] leading-snug text-ink-soft dark:text-foreground/80">{permission.description}</div>
        )}
      </div>
      <div className="inline-flex shrink-0 items-center gap-1.5">
        <ScopePill kind={permission.level} label={t(`actions.${permission.level}`)} />
      </div>
    </li>
  );
}

interface ExpiredPaneProps {
  clientInfo: OAuthClientInfo | null;
  identity: ConsentIdentity;
}

function ExpiredPane({ clientInfo, identity }: ExpiredPaneProps) {
  const t = useTranslations('dashboard.oauthConsent');
  return (
    <>
      <IdentityCard clientInfo={clientInfo} identity={identity} />

      <div className="flex flex-col gap-4 px-7 py-8">
        <div className="font-serif text-[24px] tracking-[-0.01em] [overflow-wrap:anywhere]">
          {t('expired.panelTitle')}
        </div>
        <div className="max-w-[52ch] text-sm leading-relaxed text-ink-soft [overflow-wrap:anywhere] dark:text-foreground/80">
          {t('expired.body')}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t-[1px] border-rule-soft px-7 py-5 dark:border-rule-on-dark">
        <a
          href="/dashboard"
          className="inline-flex h-11 items-center justify-center border-[1px] border-ink bg-transparent px-6 font-sans text-[15px] font-medium text-ink no-underline transition hover:bg-ink hover:text-paper dark:border-paper dark:text-paper dark:hover:bg-paper dark:hover:text-ink"
        >
          {t('expired.dashboard')}
        </a>
      </div>
    </>
  );
}

interface WrongAccountPaneProps {
  clientInfo: OAuthClientInfo | null;
  identity: ConsentIdentity;
  userName: string;
  orgId: string;
  busy: 'allow' | 'deny' | null;
  switching: boolean;
  error: string | null;
  onSwitchAccount: () => void;
  onCancel: () => void;
}

function WrongAccountPane({
  clientInfo,
  identity,
  userName,
  orgId,
  busy,
  switching,
  error,
  onSwitchAccount,
  onCancel,
}: WrongAccountPaneProps) {
  const t = useTranslations('dashboard.oauthConsent');
  const disabled = busy !== null || switching;
  return (
    <>
      <IdentityCard clientInfo={clientInfo} identity={identity} />

      <div className="flex flex-col gap-4 px-7 py-8">
        <div className="font-serif text-[24px] tracking-[-0.01em] [overflow-wrap:anywhere]">
          {t('wrongAccount.panelTitle')}
        </div>
        <div className="max-w-[52ch] text-sm leading-relaxed text-ink-soft [overflow-wrap:anywhere] dark:text-foreground/80">
          {t.rich('wrongAccount.body', {
            org: () => <code className="font-mono text-[12.5px] text-ink dark:text-foreground">{orgId}</code>,
            user: () => <b className="font-semibold text-ink dark:text-foreground">{userName || '…'}</b>,
          })}
        </div>
      </div>

      {error && (
        <p className="px-7 pb-3 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t-[1px] border-rule-soft px-7 py-5 dark:border-rule-on-dark">
        <button
          type="button"
          onClick={onSwitchAccount}
          disabled={disabled}
          className="inline-flex h-11 items-center justify-center border-[1px] border-ink bg-ink px-6 font-sans text-[15px] font-medium text-paper transition hover:bg-cobalt hover:border-cobalt dark:border-paper dark:bg-paper dark:text-ink dark:hover:border-cobalt-soft dark:hover:bg-cobalt-soft dark:hover:text-ink disabled:cursor-not-allowed disabled:opacity-60"
        >
          {switching ? t('wrongAccount.switching') : t('wrongAccount.switch')}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={disabled}
          className="inline-flex h-11 items-center justify-center border-[1px] border-ink bg-transparent px-6 font-sans text-[15px] font-medium text-ink transition hover:bg-ink hover:text-paper dark:border-paper dark:text-paper dark:hover:bg-paper dark:hover:text-ink disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy === 'deny' ? t('blocked.cancelling') : t('blocked.cancel')}
        </button>
      </div>
    </>
  );
}

interface BlockedPaneProps {
  clientInfo: OAuthClientInfo | null;
  identity: ConsentIdentity;
  denial: OAuthConsentDenial;
  busy: 'allow' | 'deny' | null;
  error: string | null;
  onCancel: () => void;
}

function BlockedPane({
  clientInfo,
  identity,
  denial,
  busy,
  error,
  onCancel,
}: BlockedPaneProps) {
  const t = useTranslations('dashboard.oauthConsent');
  return (
    <>
      <IdentityCard clientInfo={clientInfo} identity={identity} />

      <div className="flex flex-col gap-4 px-7 py-8">
        <div className="font-serif text-[24px] tracking-[-0.01em] [overflow-wrap:anywhere]">
          {t.rich('blocked.panelTitle', {
            resource: () => <em className="not-italic italic">{denial.resourceName}</em>,
          })}
        </div>
        <div className="max-w-[52ch] text-sm leading-relaxed text-ink-soft [overflow-wrap:anywhere] dark:text-foreground/80">
          {t(`blocked.reasons.${denial.reason}`)}
        </div>
        <div className="max-w-[52ch] text-[13px] leading-relaxed text-ink-mute">
          {t('blocked.switchHint')}
        </div>
      </div>

      {error && (
        <p className="px-7 pb-3 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t-[1px] border-rule-soft px-7 py-5 dark:border-rule-on-dark">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy !== null}
          className="inline-flex h-11 items-center justify-center border-[1px] border-ink bg-ink px-6 font-sans text-[15px] font-medium text-paper transition hover:bg-cobalt hover:border-cobalt dark:border-paper dark:bg-paper dark:text-ink dark:hover:border-cobalt-soft dark:hover:bg-cobalt-soft dark:hover:text-ink disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy === 'deny' ? t('blocked.cancelling') : t('blocked.cancel')}
        </button>
        <a
          href="/dashboard"
          className="inline-flex h-11 items-center justify-center border-[1px] border-ink bg-transparent px-6 font-sans text-[15px] font-medium text-ink no-underline transition hover:bg-ink hover:text-paper dark:border-paper dark:text-paper dark:hover:bg-paper dark:hover:text-ink"
        >
          {t('blocked.dashboard')}
        </a>
      </div>
    </>
  );
}

function ScopePill({ kind, label }: { kind: 'read' | 'write'; label: string }) {
  const cls =
    kind === 'write'
      ? 'border-cobalt text-cobalt bg-cobalt/5 dark:border-cobalt-soft dark:text-cobalt-soft dark:bg-cobalt-soft/10'
      : 'border-rule-soft text-ink-soft dark:border-rule-on-dark dark:text-foreground/80';
  return (
    <span
      className={`whitespace-nowrap rounded-full border-[1px] px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.1em] ${cls}`}
    >
      {label}
    </span>
  );
}

function ReassuranceBlock({ displayName, userName }: { displayName: string; userName: string }) {
  const t = useTranslations('dashboard.oauthConsent');
  return (
    <div className="mx-7 my-3 border-[1px] border-rule-soft bg-paper-deep px-4 py-3.5 text-[12.5px] leading-relaxed text-ink-soft [overflow-wrap:anywhere] [word-break:break-word] dark:border-rule-on-dark dark:bg-secondary dark:text-foreground/80">
      <b className="font-semibold text-ink dark:text-foreground">{t('reassurance.lead')}</b>{' '}
      {t.rich('reassurance.body', {
        client: () => <b className="font-semibold text-ink dark:text-foreground">{displayName}</b>,
        user: () => <b className="font-semibold text-ink dark:text-foreground">{userName || '…'}</b>,
        settings: (chunks) => (
          <a className="text-cobalt no-underline hover:underline dark:text-cobalt-soft" href="/dashboard/settings/agents">
            {chunks}
          </a>
        ),
      })}
    </div>
  );
}

interface ActionsFooterProps {
  userName: string;
  busy: 'allow' | 'deny' | null;
  onAuthorize: () => void;
  onDeny: () => void;
  onSwitchAccount: () => void;
}

function ActionsFooter({ userName, busy, onAuthorize, onDeny, onSwitchAccount }: ActionsFooterProps) {
  const t = useTranslations('dashboard.oauthConsent');
  return (
    <div className="flex flex-wrap items-center gap-3 border-t-[1px] border-rule-soft px-7 py-5 dark:border-rule-on-dark">
      <button
        type="button"
        onClick={onAuthorize}
        disabled={busy !== null}
        className="inline-flex h-11 items-center justify-center gap-2 border-[1px] border-ink bg-ink px-6 font-sans text-[15px] font-medium text-paper transition hover:bg-cobalt hover:border-cobalt dark:border-paper dark:bg-paper dark:text-ink dark:hover:border-cobalt-soft dark:hover:bg-cobalt-soft dark:hover:text-ink disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy === 'allow' ? t('authorizing') : t('authorize')}
        {busy !== 'allow' && (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 12h14M13 5l7 7-7 7" />
          </svg>
        )}
      </button>
      <button
        type="button"
        onClick={onDeny}
        disabled={busy !== null}
        className="inline-flex h-11 items-center justify-center border-[1px] border-ink bg-transparent px-6 font-sans text-[15px] font-medium text-ink transition hover:bg-ink hover:text-paper dark:border-paper dark:text-paper dark:hover:bg-paper dark:hover:text-ink disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy === 'deny' ? t('denying') : t('deny')}
      </button>
      <div className="ml-auto text-right text-[12px] leading-snug text-ink-mute">
        {t.rich('actingAs', {
          user: () => <span>{userName || '…'}</span>,
        })}
        <br />
        <button
          type="button"
          onClick={onSwitchAccount}
          disabled={busy !== null}
          className="text-cobalt no-underline hover:underline disabled:cursor-not-allowed disabled:opacity-60 dark:text-cobalt-soft"
        >
          {t('switchAccount')}
        </button>
      </div>
    </div>
  );
}

function ResultPane({
  flow,
  displayName,
  redirectHost,
}: {
  flow: 'granted' | 'denied';
  displayName: string;
  redirectHost: string;
}) {
  const t = useTranslations('dashboard.oauthConsent');
  const isGranted = flow === 'granted';
  return (
    <div className="flex flex-col gap-4 px-7 py-8">
      <div
        className={`inline-flex h-11 w-11 items-center justify-center rounded-full border-[1px] ${
          isGranted
            ? 'border-cobalt/40 bg-cobalt/10 text-cobalt-deep dark:border-cobalt-soft/40 dark:bg-cobalt-soft/10 dark:text-cobalt-soft'
            : 'border-rule-soft bg-paper-deep text-ink-soft dark:border-rule-on-dark dark:bg-secondary dark:text-foreground/80'
        }`}
      >
        {isGranted ? (
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 12.5l5 5 11-11" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        )}
      </div>
      <div className="font-serif text-[24px] tracking-[-0.01em] [overflow-wrap:anywhere]">
        {isGranted
          ? t.rich('granted.panelTitle', { client: () => <em className="not-italic italic">{displayName}</em> })
          : t('denied.panelTitle')}
      </div>
      <div className="max-w-[52ch] text-sm leading-relaxed text-ink-soft [overflow-wrap:anywhere] dark:text-foreground/80">
        {isGranted
          ? t.rich('granted.panelBody', {
              client: () => <em className="not-italic font-medium text-ink italic dark:text-foreground">{displayName}</em>,
              strong: (chunks) => <strong className="font-medium text-ink dark:text-foreground">{chunks}</strong>,
            })
          : t.rich('denied.panelBody', {
              client: () => <em className="not-italic font-medium text-ink italic dark:text-foreground">{displayName}</em>,
            })}
      </div>
      {redirectHost && (
        <div className="mt-1 flex items-center gap-2.5 font-mono text-[11px] tracking-[0.04em] text-ink-mute">
          <Spinner />
          <span>
            {isGranted
              ? t('granted.redirecting', { host: redirectHost })
              : t('denied.redirecting', { host: redirectHost })}
          </span>
        </div>
      )}
    </div>
  );
}

function Spinner() {
  return (
    <span
      className="inline-block h-3 w-3 rounded-full border-[1.5px] border-ink-mute border-t-transparent"
      style={{ animation: 'munin-consent-spin 0.9s linear infinite' }}
    />
  );
}

if (typeof document !== 'undefined') {
  const id = 'munin-consent-spin-keyframes';
  if (!document.getElementById(id)) {
    const style = document.createElement('style');
    style.id = id;
    style.textContent = '@keyframes munin-consent-spin{to{transform:rotate(360deg)}}';
    document.head.appendChild(style);
  }
}
