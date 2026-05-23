'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Link, useRouter } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';
import {
  api,
  ApiError,
  authClient,
  AuthShell,
  AuthEpigraph,
  AuthHeading,
  AuthSubheading,
  AuthFootnote,
  AuthField,
  AuthLabel,
  AuthInput,
  AuthSubmit,
  ErrorAlert,
  OSS_AUTH_FOOTER,
} from '@getmunin/dashboard-pages';
import { useTranslateError } from '@/lib/translate-error';

function safeRedirect(raw: string | null): string {
  if (raw && raw.startsWith('/') && !raw.startsWith('//')) return raw;
  return '/dashboard';
}

function resumeOauthAuthorizeUrl(params: URLSearchParams): string | null {
  if (params.get('response_type') !== 'code') return null;
  if (!params.get('client_id')) return null;
  const apiBase = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001').replace(/\/+$/, '');
  if (!/^https?:\/\//.test(apiBase)) return null;
  return `${apiBase}/auth/oauth2/authorize?${params.toString()}`;
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
        setSubmitting(false);
        return;
      }
      await refetch();
      const oauthResume = resumeOauthAuthorizeUrl(params);
      if (oauthResume) {
        window.location.assign(oauthResume);
        return;
      }
      router.push(redirectTo);
    } catch (err) {
      setError(translateError(err) || tCommon('networkError'));
      setSubmitting(false);
    }
  }

  const signInHref = redirectRaw
    ? `/login?redirect=${encodeURIComponent(redirectRaw)}`
    : '/login';

  return (
    <AuthShell
      rightZone={<AuthEpigraph state="signup" footer={OSS_AUTH_FOOTER} />}
      leftZone={
        <>
          <AuthHeading>{t('title')}</AuthHeading>
          <AuthSubheading>
            {inviteEmail ? t('invitationSubtitle', { email: inviteEmail }) : t('subtitle')}
          </AuthSubheading>

          {inviteError && <ErrorAlert title={inviteError} />}
          {error && !inviteError && <ErrorAlert title={error} />}

          <form
            onSubmit={(event) => {
              void onSubmit(event);
            }}
          >
            <AuthField>
              <AuthLabel htmlFor="su-name">{tFields('name')}</AuthLabel>
              <AuthInput
                id="su-name"
                type="text"
                autoComplete="name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </AuthField>
            <AuthField>
              <AuthLabel htmlFor="su-email">{tFields('email')}</AuthLabel>
              <AuthInput
                id="su-email"
                type="email"
                autoComplete="email"
                required
                readOnly={inviteEmail !== null}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </AuthField>
            <AuthField>
              <AuthLabel htmlFor="su-pw">{tFields('password')}</AuthLabel>
              <AuthInput
                id="su-pw"
                type="password"
                autoComplete="new-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </AuthField>
            <AuthSubmit type="submit" disabled={submitting}>
              {submitting ? t('submitting') : t('submit')}
            </AuthSubmit>
          </form>

          <AuthFootnote>
            {t('haveAccount')}{' '}
            <Link
              href={signInHref}
              className="text-ink underline underline-offset-[3px] decoration-1"
            >
              {t('signInLink')}
            </Link>
          </AuthFootnote>
        </>
      }
    />
  );
}

export default function SignupPage() {
  return (
    <Suspense fallback={null}>
      <SignupForm />
    </Suspense>
  );
}
