'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button, Card, CardContent, Hero, PageSpinner } from '@getmunin/ui';
import { authClient } from '../auth-client';
import { api, ApiError } from '../api';
import { useTranslateError } from '../i18n/translate-error';

interface OAuthConsentResponse {
  redirect_uri?: string;
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

  const [busy, setBusy] = useState<'allow' | 'deny' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isPending && !session) {
      const next = encodeURIComponent(window.location.href);
      window.location.assign(`/login?next=${next}`);
    }
  }, [isPending, session]);

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

  async function submit(accept: boolean) {
    setBusy(accept ? 'allow' : 'deny');
    setError(null);
    try {
      const resp = await api<OAuthConsentResponse>('/auth/oauth2/consent', {
        method: 'POST',
        body: JSON.stringify({ accept, oauth_query: oauthQuery }),
      });
      if (resp?.redirect_uri) window.location.assign(resp.redirect_uri);
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
                client: () => <em>{clientId}</em>,
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
              <p className="mt-1 font-mono text-sm">{clientId}</p>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                {t('scopesLabel')}
              </p>
              {scopes.length === 0 ? (
                <p className="mt-1 text-sm text-muted-foreground">{t('noScopes')}</p>
              ) : (
                <ul className="mt-2 space-y-1">
                  {scopes.map((scope) => (
                    <li key={scope} className="font-mono text-sm">
                      {scope}
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
