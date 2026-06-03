'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { authClient } from '../../auth-client';
import { Link } from '../../i18n-navigation';
import {
  AuthShell,
  AuthHeading,
  AuthSubheading,
  AuthFootnote,
} from './auth-shell';
import { AuthEpigraph } from './auth-epigraph';
import { ErrorAlert } from './error-alert';
import { AuthField, AuthLabel, AuthInput, AuthSubmit } from './auth-form';
import type { AuthFooter } from './epigraphs';

export interface ForgotPasswordPageProps {
  footer: AuthFooter;
}

export function ForgotPasswordPage({ footer }: ForgotPasswordPageProps) {
  const t = useTranslations('auth.forgotPassword');
  const tFields = useTranslations('auth.fields');
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const redirectTo = `${window.location.origin}/reset-password?email=${encodeURIComponent(email)}`;
    const res = await authClient.requestPasswordReset({ email, redirectTo });
    setSubmitting(false);
    if (res.error) {
      setError(t('failed'));
      return;
    }
    setSent(true);
  }

  return (
    <AuthShell
      rightZone={<AuthEpigraph state="forgot" footer={footer} />}
      leftZone={
        sent ? (
          <>
            <AuthHeading>
              {t('sentTitleRichPre')}
              <em className="text-auth-navy not-italic font-serif italic">
                {t('sentTitleRichEm')}
              </em>
              {t('sentTitleRichPost')}
            </AuthHeading>
            <AuthSubheading>{t('sentBody', { email })}</AuthSubheading>

            <div className="mb-[22px] bg-paper-deep px-4 py-3.5 text-[13px] leading-[1.5] text-ink-soft">
              {t('sentInfo')}
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                setSent(false);
                setError(null);
              }}
            >
              <AuthSubmit type="submit" variant="ghost" autoFocus>
                {t('resend')}
              </AuthSubmit>
            </form>

            <AuthFootnote>
              <Link
                href="/login"
                className="text-ink underline underline-offset-[3px] decoration-1"
              >
                {t('backToSignIn')}
              </Link>
            </AuthFootnote>
          </>
        ) : (
          <>
            <AuthHeading>{t('title')}</AuthHeading>
            <AuthSubheading>{t('subtitle')}</AuthSubheading>

            {error && <ErrorAlert title={error} />}

            <form onSubmit={(e) => void onSubmit(e)}>
              <AuthField>
                <AuthLabel htmlFor="fp-email">{tFields('email')}</AuthLabel>
                <AuthInput
                  id="fp-email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </AuthField>
              <AuthSubmit type="submit" disabled={submitting}>
                {submitting ? t('submitting') : t('submit')}
              </AuthSubmit>
            </form>

            <AuthFootnote>
              <Link
                href="/login"
                className="text-ink underline underline-offset-[3px] decoration-1"
              >
                {t('backToSignIn')}
              </Link>
            </AuthFootnote>
          </>
        )
      }
    />
  );
}
