'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { authClient } from '../../auth-client';
import { Link, useRouter } from '../../i18n-navigation';
import { useTranslateError } from '../../i18n/translate-error';
import { safeRedirect, resumeOauthAuthorizeUrl } from '../../auth/post-signin-redirect';
import {
  AuthShell,
  AuthHeading,
  AuthSubheading,
  AuthFootnote,
  AuthDivider,
} from './auth-shell';
import { AuthEpigraph } from './auth-epigraph';
import { ErrorAlert } from './error-alert';
import { AuthField, AuthLabel, AuthInput, AuthSubmit, AuthOAuthButton } from './auth-form';
import { GoogleLogo, GithubLogo } from './oauth-logos';
import type { AuthFooter } from './epigraphs';
import type { AuthProviders } from './fetch-auth-providers';

type SignInError = { kind: 'invalid' | 'unreachable'; detail: string };

export interface LoginFormProps {
  providers: AuthProviders;
  footer: AuthFooter;
}

export function LoginForm({ providers, footer }: LoginFormProps) {
  const t = useTranslations('auth.signIn');
  const tInvalid = useTranslations('auth.signIn.invalid');
  const tUnreachable = useTranslations('auth.signIn.unreachable');
  const tFields = useTranslations('auth.fields');
  const tForgot = useTranslations('auth.forgotPassword');
  const tCommon = useTranslations('common');
  const tGoogle = useTranslations('ui.googleButton');
  const tGithub = useTranslations('ui.githubButton');
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
      rightZone={<AuthEpigraph state={epigraphState} footer={footer} />}
      leftZone={
        <>
          <AuthHeading>{t('title')}</AuthHeading>
          <AuthSubheading>{t('subtitle')}</AuthSubheading>

          {error && <ErrorAlert title={alertTitle}>{alertHint}</ErrorAlert>}

          {providers.google && (
            <AuthOAuthButton
              onClick={() => {
                void authClient.signIn.social({
                  provider: 'google',
                  callbackURL: redirectTo,
                });
              }}
            >
              <GoogleLogo />
              {tGoogle('signIn')}
            </AuthOAuthButton>
          )}
          {providers.google && providers.github && <div className="h-3" />}
          {providers.github && (
            <AuthOAuthButton
              onClick={() => {
                void authClient.signIn.social({
                  provider: 'github',
                  callbackURL: redirectTo,
                });
              }}
            >
              <GithubLogo />
              {tGithub('signIn')}
            </AuthOAuthButton>
          )}
          {(providers.google || providers.github) && (
            <AuthDivider label={tCommon('or')} />
          )}

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
            {' · '}
            <Link
              href="/forgot-password"
              className="text-ink underline underline-offset-[3px] decoration-1"
            >
              {tForgot('linkLabel')}
            </Link>
          </AuthFootnote>
        </>
      }
    />
  );
}
