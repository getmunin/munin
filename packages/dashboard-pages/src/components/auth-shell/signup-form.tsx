'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { api, ApiError } from '../../api';
import { authClient } from '../../auth-client';
import { Link, useRouter } from '../../i18n-navigation';
import { useTranslateError } from '../../i18n/translate-error';
import {
  absoluteCallbackUrl,
  safeRedirect,
  hasOauthAuthorizeParams,
} from '../../auth/post-signin-redirect';
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

export interface SignupFormProps {
  providers: AuthProviders;
  footer: AuthFooter;
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

export function SignupForm({ providers, footer }: SignupFormProps) {
  const t = useTranslations('auth.signUp');
  const tFields = useTranslations('auth.fields');
  const tCommon = useTranslations('common');
  const tGoogle = useTranslations('ui.googleButton');
  const tGithub = useTranslations('ui.githubButton');
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
          `/v1/invitations/lookup?token=${encodeURIComponent(inviteToken)}`,
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
      if (hasOauthAuthorizeParams(params)) {
        router.push(`/setup?${params.toString()}`);
        return;
      }
      router.push(redirectTo);
    } catch (err) {
      setError(translateError(err) || tCommon('networkError'));
      setSubmitting(false);
    }
  }

  const signInHref = hasOauthAuthorizeParams(params)
    ? `/login?${params.toString()}`
    : redirectRaw
      ? `/login?redirect=${encodeURIComponent(redirectRaw)}`
      : '/login';

  return (
    <AuthShell
      rightZone={<AuthEpigraph state="signup" footer={footer} />}
      leftZone={
        <>
          <AuthHeading>{t('title')}</AuthHeading>
          <AuthSubheading>
            {inviteEmail ? t('invitationSubtitle', { email: inviteEmail }) : t('subtitle')}
          </AuthSubheading>

          {inviteError && <ErrorAlert title={inviteError} />}
          {error && !inviteError && <ErrorAlert title={error} />}

          {!inviteToken && providers.google && (
            <AuthOAuthButton
              onClick={() => {
                void authClient.signIn.social({
                  provider: 'google',
                  callbackURL: absoluteCallbackUrl(redirectTo),
                });
              }}
            >
              <GoogleLogo />
              {tGoogle('signUp')}
            </AuthOAuthButton>
          )}
          {!inviteToken && providers.google && providers.github && <div className="h-3" />}
          {!inviteToken && providers.github && (
            <AuthOAuthButton
              onClick={() => {
                void authClient.signIn.social({
                  provider: 'github',
                  callbackURL: absoluteCallbackUrl(redirectTo),
                });
              }}
            >
              <GithubLogo />
              {tGithub('signUp')}
            </AuthOAuthButton>
          )}
          {!inviteToken && (providers.google || providers.github) && (
            <AuthDivider label={tCommon('or')} />
          )}

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
