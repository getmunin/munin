'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { PageSpinner } from '@getmunin/ui';
import { authClient } from '../auth-client';
import { api, ApiError } from '../api';
import { useTranslateError } from '../i18n/translate-error';

export interface OAuthClientInfo {
  client_id: string;
  name: string | null;
  uri: string | null;
  icon_url: string;
  redirect_uri_host: string | null;
  created_at: string;
}

export interface OAuthConsentPageProps {
  /** Server-fetched client info. If `null`, the page falls back to client-side
   *  rendering of the raw `client_id` (e.g. when the lookup failed). */
  clientInfo: OAuthClientInfo | null;
}

interface OAuthConsentResponse {
  url?: string;
  redirect_uri?: string;
}

const HIDDEN_SCOPES = new Set([
  'openid',
  'profile',
  'email',
  'offline_access',
  'mcp:tools',
  'mcp:admin',
  'mcp:self_service',
]);

const MODULE_ORDER = ['kb', 'conv', 'crm', 'cms', 'outreach', 'analytics'] as const;
type ModuleKey = (typeof MODULE_ORDER)[number];

interface ModuleScopes {
  module: ModuleKey;
  read: boolean;
  write: boolean;
}

function groupScopes(scopes: string[]): ModuleScopes[] {
  const known = new Set<string>(MODULE_ORDER);
  const map = new Map<ModuleKey, ModuleScopes>();
  for (const scope of scopes) {
    if (HIDDEN_SCOPES.has(scope)) continue;
    const [mod, action] = scope.split(':', 2);
    if (!mod || !action || !known.has(mod)) continue;
    const key = mod as ModuleKey;
    let entry = map.get(key);
    if (!entry) {
      entry = { module: key, read: false, write: false };
      map.set(key, entry);
    }
    if (action === 'read') entry.read = true;
    if (action === 'write') entry.write = true;
  }
  return MODULE_ORDER.filter((m) => map.has(m)).map((m) => map.get(m)!);
}

type FlowState = 'new' | 'granted' | 'denied';

const REDIRECT_DELAY_MS = 1200;

export function OAuthConsentPage({ clientInfo }: OAuthConsentPageProps) {
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
  const groupedScopes = useMemo(() => groupScopes(scopes), [scopes]);
  const totalScopeCount = useMemo(
    () => groupedScopes.reduce((n, g) => n + (g.read ? 1 : 0) + (g.write ? 1 : 0), 0),
    [groupedScopes],
  );

  const [flow, setFlow] = useState<FlowState>('new');
  const [busy, setBusy] = useState<'allow' | 'deny' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isPending && !session) {
      const next = encodeURIComponent(window.location.href);
      window.location.assign(`/login?next=${next}`);
    }
  }, [isPending, session]);

  if (isPending || !session) {
    return <PageSpinner className="min-h-screen bg-background" />;
  }

  if (!clientId || !oauthQuery) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bone px-6 dark:bg-background">
        <div className="max-w-md border-[0.5px] border-ink bg-paper p-6 text-sm text-destructive dark:border-rule-on-dark dark:bg-card">
          {t('missingParams')}
        </div>
      </div>
    );
  }

  const displayName = clientInfo?.name?.trim() ? clientInfo.name : clientId;
  const userName = session.user?.name?.trim() || session.user?.email || '';
  const redirectHost = clientInfo?.redirect_uri_host ?? '';

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

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto flex w-full max-w-[720px] flex-col px-6 py-12 sm:py-16">
        <EditorialHeader
          flow={flow}
          clientName={displayName}
        />

        <section className="mt-8 border-[0.5px] border-ink bg-paper dark:border-rule-on-dark dark:bg-card">
          {flow === 'new' ? (
            <RequestPane
              clientInfo={clientInfo}
              clientId={clientId}
              displayName={displayName}
              userName={userName}
              groupedScopes={groupedScopes}
              totalScopeCount={totalScopeCount}
              busy={busy}
              error={error}
              onSubmit={(accept) => void submit(accept)}
              onSwitchAccount={() => {
                void (async () => {
                  const next = encodeURIComponent(window.location.href);
                  await authClient.signOut();
                  window.location.assign(`/login?next=${next}`);
                })();
              }}
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

// ─── editorial header ────────────────────────────────────────────────

interface EditorialHeaderProps {
  flow: FlowState;
  clientName: string;
}

function EditorialHeader({ flow, clientName }: EditorialHeaderProps) {
  const t = useTranslations('dashboard.oauthConsent');
  if (flow === 'granted') {
    return (
      <header className="mb-6">
        <div className="mb-4 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.18em] text-ink-mute">
          <span className="text-cobalt">✓</span>
          <span>{t('granted.eyebrow')}</span>
        </div>
        <h1 className="font-serif text-[clamp(46px,6.6vw,72px)] font-normal leading-[0.98] tracking-[-0.02em] min-w-0 [overflow-wrap:anywhere] [word-break:break-word]">
          {t.rich('granted.title', { em: (chunks) => <em className="not-italic text-cobalt italic">{chunks}</em> })}
        </h1>
        <p className="mt-4 max-w-[54ch] text-base leading-relaxed text-ink-soft [overflow-wrap:anywhere]">
          {t.rich('granted.sub', {
            client: () => <em className="not-italic font-medium text-ink italic">{clientName}</em>,
            strong: (chunks) => <strong className="font-medium text-ink">{chunks}</strong>,
          })}
        </p>
      </header>
    );
  }
  if (flow === 'denied') {
    return (
      <header className="mb-6">
        <div className="mb-4 font-mono text-[11px] uppercase tracking-[0.18em] text-ink-mute">
          {t('denied.eyebrow')}
        </div>
        <h1 className="font-serif text-[clamp(46px,6.6vw,72px)] font-normal leading-[0.98] tracking-[-0.02em] min-w-0 [overflow-wrap:anywhere] [word-break:break-word]">
          {t.rich('denied.title', { em: (chunks) => <em className="not-italic text-ink italic">{chunks}</em> })}
        </h1>
        <p className="mt-4 max-w-[54ch] text-base leading-relaxed text-ink-soft [overflow-wrap:anywhere]">
          {t.rich('denied.sub', {
            client: () => <em className="not-italic font-medium text-ink italic">{clientName}</em>,
            strong: (chunks) => <strong className="font-medium text-ink">{chunks}</strong>,
          })}
        </p>
      </header>
    );
  }
  return (
    <header className="mb-6">
      <div className="mb-4 font-mono text-[11px] uppercase tracking-[0.18em] text-ink-mute">
        {t('eyebrow')}
      </div>
      <h1 className="font-serif text-[clamp(46px,6.6vw,72px)] font-normal leading-[0.98] tracking-[-0.02em] min-w-0 [overflow-wrap:anywhere] [word-break:break-word]">
        {t.rich('title', { client: () => <em className="not-italic text-cobalt italic">{clientName}</em> })}
      </h1>
      <p className="mt-4 max-w-[54ch] text-base leading-relaxed text-ink-soft">
        {t.rich('lede', {
          client: () => <em className="not-italic font-medium text-ink italic">{clientName}</em>,
        })}
      </p>
    </header>
  );
}

// ─── request pane (the `new` state) ─────────────────────────────────

interface RequestPaneProps {
  clientInfo: OAuthClientInfo | null;
  clientId: string;
  displayName: string;
  userName: string;
  groupedScopes: ModuleScopes[];
  totalScopeCount: number;
  busy: 'allow' | 'deny' | null;
  error: string | null;
  onSubmit: (accept: boolean) => void;
  onSwitchAccount: () => void;
}

function RequestPane({
  clientInfo,
  clientId,
  displayName,
  userName,
  groupedScopes,
  totalScopeCount,
  busy,
  error,
  onSubmit,
  onSwitchAccount,
}: RequestPaneProps) {
  const t = useTranslations('dashboard.oauthConsent');
  return (
    <>
      <IdentityCard clientInfo={clientInfo} clientId={clientId} displayName={displayName} />
      <TrustTimeline clientName={displayName} />

      <div className="px-7 pt-2 pb-1">
        <div className="flex items-baseline justify-between py-4">
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-mute">
            {t('scopesLabel')}
          </span>
          <span className="font-mono text-[11px] text-ink-soft">
            {t('scopesCount', { modules: groupedScopes.length, scopes: totalScopeCount })}
          </span>
        </div>

        {groupedScopes.length === 0 ? (
          <p className="pb-4 text-sm text-ink-soft">{t('noModuleScopes')}</p>
        ) : (
          <ul className="border-t-[0.5px] border-rule-soft dark:border-rule-on-dark">
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

// ─── identity card ──────────────────────────────────────────────────

interface IdentityCardProps {
  clientInfo: OAuthClientInfo | null;
  clientId: string;
  displayName: string;
}

function IdentityCard({ clientInfo, clientId, displayName }: IdentityCardProps) {
  const t = useTranslations('dashboard.oauthConsent');
  const firstChar = (clientInfo?.name?.trim() ?? clientId).slice(0, 1).toUpperCase();
  const registeredLabel = formatRegistered(clientInfo?.created_at);
  return (
    <div
      className={`flex gap-4 border-b-[0.5px] border-rule-soft px-7 py-5 dark:border-rule-on-dark ${
        registeredLabel ? 'items-start' : 'items-center'
      }`}
    >
      <div className="flex h-[50px] w-[50px] shrink-0 items-center justify-center overflow-hidden rounded-xl border-[0.5px] border-ink bg-white font-serif text-[28px] leading-none text-ink dark:border-rule-on-dark">
        {clientInfo?.icon_url ? (
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
        {registeredLabel && (
          <div className="font-mono text-[11px] tracking-[0.02em] text-ink-mute">
            {t('registered', { date: registeredLabel })}
          </div>
        )}
      </div>
    </div>
  );
}

function formatRegistered(iso: string | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long' });
}

// ─── trust timeline ─────────────────────────────────────────────────

function TrustTimeline({ clientName }: { clientName: string }) {
  const t = useTranslations('dashboard.oauthConsent');
  return (
    <div className="flex items-center gap-3 border-b-[0.5px] border-rule-soft bg-paper px-7 py-3 text-[13px] leading-snug text-ink-soft dark:border-rule-on-dark dark:bg-card">
      <span className="text-ink-mute">
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 8v4l3 2" />
        </svg>
      </span>
      <span className="min-w-0 [overflow-wrap:anywhere]">
        {t.rich('trustFirst', {
          client: () => <strong className="font-semibold text-ink">{clientName}</strong>,
        })}
      </span>
    </div>
  );
}

// ─── permission row ─────────────────────────────────────────────────

function PermissionRow({ group }: { group: ModuleScopes }) {
  const t = useTranslations('dashboard.oauthConsent');
  const descKey = group.write
    ? `moduleDescriptions.${group.module}.readWrite`
    : `moduleDescriptions.${group.module}.read`;
  return (
    <li className="grid grid-cols-[1fr_auto] items-center gap-x-4 border-t-[0.5px] border-rule-soft py-3.5 first:border-t-0 dark:border-rule-on-dark">
      <div className="min-w-0">
        <div className="text-[15px] font-semibold text-ink">{t(`modules.${group.module}`)}</div>
        <div className="mt-1 text-[13px] leading-snug text-ink-soft">
          {t(descKey)}
        </div>
      </div>
      <div className="inline-flex shrink-0 items-center gap-1.5">
        {group.read && <ScopePill kind="read" label={t('actions.read')} />}
        {group.write && <ScopePill kind="write" label={t('actions.write')} />}
      </div>
    </li>
  );
}

function ScopePill({ kind, label }: { kind: 'read' | 'write'; label: string }) {
  const cls =
    kind === 'write'
      ? 'border-cobalt text-cobalt bg-cobalt/5'
      : 'border-rule-soft text-ink-soft';
  return (
    <span
      className={`whitespace-nowrap rounded-full border-[0.5px] px-2 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.1em] ${cls}`}
    >
      {label}
    </span>
  );
}

// ─── reassurance ────────────────────────────────────────────────────

function ReassuranceBlock({ displayName, userName }: { displayName: string; userName: string }) {
  const t = useTranslations('dashboard.oauthConsent');
  return (
    <div className="mx-7 my-3 border-[0.5px] border-rule-soft bg-paper-deep px-4 py-3.5 text-[12.5px] leading-relaxed text-ink-soft [overflow-wrap:anywhere] [word-break:break-word] dark:border-rule-on-dark dark:bg-secondary">
      <b className="font-semibold text-ink">{t('reassurance.lead')}</b>{' '}
      {t.rich('reassurance.body', {
        client: () => <b className="font-semibold text-ink">{displayName}</b>,
        user: () => <b className="font-semibold text-ink">{userName || '…'}</b>,
        settings: (chunks) => (
          <a className="text-cobalt no-underline hover:underline" href="/dashboard/settings/agents">
            {chunks}
          </a>
        ),
      })}
    </div>
  );
}

// ─── actions ────────────────────────────────────────────────────────

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
    <div className="flex flex-wrap items-center gap-3 border-t-[0.5px] border-rule-soft px-7 py-5 dark:border-rule-on-dark">
      <button
        type="button"
        onClick={onAuthorize}
        disabled={busy !== null}
        className="inline-flex h-11 items-center justify-center gap-2 border-[0.5px] border-ink bg-ink px-6 font-sans text-[15px] font-medium text-paper transition hover:bg-cobalt hover:border-cobalt disabled:cursor-not-allowed disabled:opacity-60"
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
        className="inline-flex h-11 items-center justify-center border-[0.5px] border-ink bg-transparent px-6 font-sans text-[15px] font-medium text-ink transition hover:bg-ink hover:text-paper disabled:cursor-not-allowed disabled:opacity-60"
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
          className="text-cobalt no-underline hover:underline disabled:cursor-not-allowed disabled:opacity-60"
        >
          {t('switchAccount')}
        </button>
      </div>
    </div>
  );
}

// ─── result pane (granted / denied) ─────────────────────────────────

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
        className={`inline-flex h-11 w-11 items-center justify-center rounded-full border-[0.5px] ${
          isGranted
            ? 'border-cobalt/40 bg-cobalt/10 text-cobalt-deep'
            : 'border-rule-soft bg-paper-deep text-ink-soft'
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
      <div className="max-w-[52ch] text-sm leading-relaxed text-ink-soft [overflow-wrap:anywhere]">
        {isGranted
          ? t.rich('granted.panelBody', {
              client: () => <em className="not-italic font-medium text-ink italic">{displayName}</em>,
              strong: (chunks) => <strong className="font-medium text-ink">{chunks}</strong>,
            })
          : t.rich('denied.panelBody', {
              client: () => <em className="not-italic font-medium text-ink italic">{displayName}</em>,
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

// ─── inline keyframes (kept local so we don't bloat global CSS) ─────

if (typeof document !== 'undefined') {
  const id = 'munin-consent-spin-keyframes';
  if (!document.getElementById(id)) {
    const style = document.createElement('style');
    style.id = id;
    style.textContent = '@keyframes munin-consent-spin{to{transform:rotate(360deg)}}';
    document.head.appendChild(style);
  }
}
