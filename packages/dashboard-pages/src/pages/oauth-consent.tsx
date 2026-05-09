'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Button, Card, CardContent, Hero, PageSpinner } from '@getmunin/ui';
import { authClient } from '../auth-client';
import { api, ApiError } from '../api';

interface OAuthConsentResponse {
  redirect_uri?: string;
}

export function OAuthConsentPage() {
  const search = useSearchParams();
  const { data: session, isPending } = authClient.useSession();

  const consentCode = search?.get('consent_code') ?? '';
  const clientId = search?.get('client_id') ?? '';
  const clientName = search?.get('client_name') ?? clientId;
  const scopeRaw = search?.get('scope') ?? '';

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

  if (!consentCode || !clientId) {
    return (
      <div className="flex min-h-screen items-center justify-center px-6">
        <Card className="max-w-md">
          <CardContent className="py-6 text-sm text-destructive">
            Missing consent_code or client_id. Return to the application that started the
            authorization flow.
          </CardContent>
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
        body: JSON.stringify({ accept, consent_code: consentCode }),
      });
      if (resp?.redirect_uri) window.location.assign(resp.redirect_uri);
      else window.history.back();
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError('Something went wrong. Please try again.');
      setBusy(null);
    }
  }

  return (
    <div className="min-h-screen bg-bone dark:bg-background">
      <main className="mx-auto max-w-xl px-6 py-16">
        <Hero
          title={
            <>
              Authorize <em>{clientName}</em>?
            </>
          }
          lede="An external application is asking for access to your Munin account. Review the requested scopes before deciding."
        />

        <Card className="mt-8">
          <CardContent className="space-y-5 py-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Application
              </p>
              <p className="mt-1 font-mono text-sm">{clientName}</p>
              <p className="font-mono text-xs text-muted-foreground">{clientId}</p>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Requested scopes
              </p>
              {scopes.length === 0 ? (
                <p className="mt-1 text-sm text-muted-foreground">(no scopes requested)</p>
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
                {busy === 'allow' ? 'Authorizing…' : 'Authorize'}
              </Button>
              <Button
                variant="outline"
                onClick={() => void submit(false)}
                disabled={busy !== null}
              >
                {busy === 'deny' ? 'Denying…' : 'Deny'}
              </Button>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
