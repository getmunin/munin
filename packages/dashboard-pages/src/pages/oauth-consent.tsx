'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button, Card, CardContent, Hero, PageSpinner } from '@getmunin/ui';
import { authClient } from '../auth-client';
import { api, ApiError } from '../api';
import { useTranslateError } from '../i18n/translate-error';

interface OAuthConsentResponse {
  url?: string;
  redirect_uri?: string;
}

interface OAuthClientInfo {
  client_id: string;
  name: string | null;
  uri: string | null;
  icon: string | null;
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

const MODULE_ORDER = ['kb', 'conv', 'crm', 'cms', 'outreach'] as const;
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

export function OAuthConsentPage() {
  const t = useTranslations('dashboard.oauthConsent');
  const translate = useTranslateError();
  const search = useSearchParams();
  const { data: session, isPending } = authClient.useSession();

  const clientId = search?.get('client_id') ?? '';
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

  const [clientInfo, setClientInfo] = useState<OAuthClientInfo | null>(null);
  const [busy, setBusy] = useState<'allow' | 'deny' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isPending && !session) {
      const next = encodeURIComponent(window.location.href);
      window.location.assign(`/login?next=${next}`);
    }
  }, [isPending, session]);

  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    void (async () => {
      try {
        const info = await api<OAuthClientInfo>(`/v1/oauth/clients/${encodeURIComponent(clientId)}`);
        if (!cancelled) setClientInfo(info);
      } catch {
        // 404 or other failure — fall back to displaying the client_id verbatim.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  if (isPending || !session) {
    return <PageSpinner className="min-h-screen bg-bone dark:bg-background" />;
  }

  if (!clientId || !oauthQuery) {
    return (
      <div className="flex min-h-screen items-center justify-center px-6">
        <Card className="max-w-md">
          <CardContent className="py-6 text-sm text-destructive">{t('missingParams')}</CardContent>
        </Card>
      </div>
    );
  }

  const displayName = clientInfo?.name?.trim() ? clientInfo.name : clientId;

  async function submit(accept: boolean) {
    setBusy(accept ? 'allow' : 'deny');
    setError(null);
    try {
      const resp = await api<OAuthConsentResponse>('/auth/oauth2/consent', {
        method: 'POST',
        body: JSON.stringify({ accept, oauth_query: oauthQuery }),
      });
      const target = resp?.url ?? resp?.redirect_uri;
      if (target) window.location.assign(target);
      else window.history.back();
    } catch (err) {
      if (err instanceof ApiError) setError(translate(err) || err.message);
      else setError(t('errors.generic'));
      setBusy(null);
    }
  }

  return (
    <div className="min-h-screen bg-bone dark:bg-background">
      <main className="mx-auto max-w-xl px-6 py-16">
        <Hero
          title={
            <>
              {t.rich('title', {
                client: () => <em>{displayName}</em>,
              })}
            </>
          }
          lede={t('lede')}
        />

        <Card className="mt-8">
          <CardContent className="space-y-5 py-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                {t('applicationLabel')}
              </p>
              <p className="mt-1 text-sm">
                {clientInfo?.name?.trim() ? clientInfo.name : <span className="font-mono">{clientId}</span>}
              </p>
              {clientInfo?.uri && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  <a className="underline" href={clientInfo.uri} target="_blank" rel="noreferrer">
                    {clientInfo.uri}
                  </a>
                </p>
              )}
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                {t('scopesLabel')}
              </p>
              {groupedScopes.length === 0 ? (
                <p className="mt-1 text-sm text-muted-foreground">{t('noModuleScopes')}</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {groupedScopes.map(({ module, read, write }) => (
                    <li key={module} className="text-sm">
                      <span className="font-medium">{t(`modules.${module}`)}</span>
                      <span className="ml-2 text-muted-foreground">
                        {[read ? t('actions.read') : null, write ? t('actions.write') : null]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}

            <div className="flex gap-3 pt-2">
              <Button onClick={() => void submit(true)} disabled={busy !== null}>
                {busy === 'allow' ? t('authorizing') : t('authorize')}
              </Button>
              <Button
                variant="outline"
                onClick={() => void submit(false)}
                disabled={busy !== null}
              >
                {busy === 'deny' ? t('denying') : t('deny')}
              </Button>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
