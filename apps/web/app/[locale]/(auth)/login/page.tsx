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

function LoginForm() {
  const t = useTranslations('auth.signIn');
  const tInvalid = useTranslations('auth.signIn.invalid');
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
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const result = await authClient.signIn.email({ email, password });
      if (result.error) {
        setError(translateError(result.error, 'unknownError') || t('failed'));
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

  const epigraphState = error ? 'login-error' : 'login';

  return (
    <AuthShell
      rightZone={<AuthEpigraph state={epigraphState} footer={OSS_AUTH_FOOTER} />}
      leftZone={
        <>
          <AuthHeading>{t('title')}</AuthHeading>
          <AuthSubheading>{t('subtitle')}</AuthSubheading>

          {error && <ErrorAlert title={tInvalid('title')}>{tInvalid('hint')}</ErrorAlert>}

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
