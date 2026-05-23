'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Link, useRouter } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';
import {
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

type SignInError = { kind: 'invalid' | 'unreachable'; detail: string };

function LoginForm() {
  const t = useTranslations('auth.signIn');
  const tInvalid = useTranslations('auth.signIn.invalid');
  const tUnreachable = useTranslations('auth.signIn.unreachable');
  const tFields = useTranslations('auth.fields');
  const tCommon = useTranslations('common');
  const translateError = useTranslateError();
  const router = useRouter();
  const params = useSearchParams();
  const redirectRaw = params.get('redirect');
  const redirectTo = safeRedirect(redirectRaw);
  const signupHref = redirectRaw
    ? `/signup?redirect=${encodeURIComponent(redirectRaw)}`
    : '/signup';
  const { refetch } = authClient.useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<SignInError | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const result = await authClient.signIn.email({ email, password });
      if (result.error) {
        setError({
          kind: 'invalid',
          detail: translateError(result.error, 'unknownError') || t('failed'),
        });
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
      setError({
        kind: 'unreachable',
        detail: translateError(err) || tCommon('networkError'),
      });
      setSubmitting(false);
    }
  }

  const epigraphState = error ? 'login-error' : 'login';
  const alertTitle = error?.kind === 'unreachable' ? tUnreachable('title') : tInvalid('title');
  const alertHint = error?.kind === 'unreachable' ? tUnreachable('hint') : tInvalid('hint');

  return (
    <AuthShell
      rightZone={<AuthEpigraph state={epigraphState} footer={OSS_AUTH_FOOTER} />}
      leftZone={
        <>
          <AuthHeading>{t('title')}</AuthHeading>
          <AuthSubheading>{t('subtitle')}</AuthSubheading>

          {error && <ErrorAlert title={alertTitle}>{alertHint}</ErrorAlert>}

          <form
            onSubmit={(event) => {
              void onSubmit(event);
            }}
          >
            <AuthField>
              <AuthLabel htmlFor="login-email">{tFields('email')}</AuthLabel>
              <AuthInput
                id="login-email"
                type="email"
                autoComplete="email"
                required
                invalid={!!error}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </AuthField>
            <AuthField>
              <AuthLabel htmlFor="login-pw">{tFields('password')}</AuthLabel>
              <AuthInput
                id="login-pw"
                type="password"
                autoComplete="current-password"
                required
                invalid={!!error}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </AuthField>
            <AuthSubmit type="submit" disabled={submitting}>
              {submitting ? t('submitting') : t('submit')}
            </AuthSubmit>
          </form>

          <AuthFootnote>
            {t('noAccount')}{' '}
            <Link
              href={signupHref}
              className="text-ink underline underline-offset-[3px] decoration-1"
            >
              {t('createAccount')}
            </Link>
          </AuthFootnote>
        </>
      }
    />
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
