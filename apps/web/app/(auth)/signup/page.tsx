'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { api, ApiError, authClient } from '@getmunin/dashboard-pages';
import { GoogleButton } from '@getmunin/ui';
import { Button } from '@getmunin/ui';
import { Input } from '@getmunin/ui';
import { Label } from '@getmunin/ui';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@getmunin/ui';
import { Separator } from '@getmunin/ui';
import { useTranslateError } from '@/lib/translate-error';

function safeRedirect(raw: string | null): string {
  if (raw && raw.startsWith('/') && !raw.startsWith('//')) return raw;
  return '/dashboard';
}

function extractInviteToken(redirectRaw: string | null): string | null {
  if (!redirectRaw) return null;
  if (!redirectRaw.startsWith('/accept-invite')) return null;
  try {
    const url = new URL(redirectRaw, 'http://placeholder');
    return url.searchParams.get('token');
  } catch {
    return null;
  }
}

function SignupForm() {
  const t = useTranslations('auth.signUp');
  const tFields = useTranslations('auth.fields');
  const tCommon = useTranslations('common');
  const tUi = useTranslations('ui.googleButton');
  const translateError = useTranslateError();
  const router = useRouter();
  const params = useSearchParams();
  const redirectRaw = params.get('redirect');
  const redirectTo = safeRedirect(redirectRaw);
  const inviteToken = extractInviteToken(redirectRaw);
  const { refetch } = authClient.useSession();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [inviteEmail, setInviteEmail] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);

  useEffect(() => {
    if (!inviteToken) return;
    void (async () => {
      try {
        const result = await api<{ email: string }>(
          `/api/v1/invitations/lookup?token=${encodeURIComponent(inviteToken)}`,
        );
        setInviteEmail(result.email);
        setEmail(result.email);
      } catch (err) {
        setInviteError(
          err instanceof ApiError ? t('invitationInvalid') : t('invitationLookupFailed'),
        );
      }
    })();
  }, [inviteToken, t]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const result = await authClient.signUp.email({ email, password, name });
      if (result.error) {
        setError(translateError(result.error) || t('failed'));
        return;
      }
      await refetch();
      router.push(redirectTo);
    } catch (err) {
      setError(translateError(err) || tCommon('networkError'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="border-0 shadow-none sm:border sm:shadow-sm">
      <CardHeader>
        <CardTitle className="text-2xl">{t('title')}</CardTitle>
        <CardDescription>
          {inviteEmail ? t('invitationSubtitle', { email: inviteEmail }) : t('subtitle')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {inviteError && <p className="text-sm text-destructive">{inviteError}</p>}
        <GoogleButton
          label={tUi('signUp')}
          onSignIn={() => {
            void authClient.signIn.social({ provider: 'google', callbackURL: redirectTo });
          }}
        />

        <DividerWithLabel label={tCommon('or')} />

        <form
          onSubmit={(event) => {
            void onSubmit(event);
          }}
          className="space-y-4"
        >
          <div className="space-y-2">
            <Label htmlFor="name">{tFields('name')}</Label>
            <Input
              id="name"
              type="text"
              autoComplete="name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">{tFields('email')}</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              readOnly={inviteEmail !== null}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">{tFields('password')}</Label>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? t('submitting') : t('submit')}
          </Button>
        </form>

        <p className="pt-2 text-sm text-muted-foreground">
          {t('haveAccount')}{' '}
          <Link
            href={redirectRaw ? `/login?redirect=${encodeURIComponent(redirectRaw)}` : '/login'}
            className="font-medium text-foreground underline"
          >
            {t('signInLink')}
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}

function DividerWithLabel({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 text-xs text-muted-foreground">
      <Separator className="flex-1" />
      {label}
      <Separator className="flex-1" />
    </div>
  );
}

export default function SignupPage() {
  return (
    <Suspense fallback={null}>
      <SignupForm />
    </Suspense>
  );
}
