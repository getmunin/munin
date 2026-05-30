'use client';

import { useState } from 'react';
import { Link } from '@/i18n/navigation';
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

export default function ForgotPasswordPage() {
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
      rightZone={<AuthEpigraph state="forgot" footer={OSS_AUTH_FOOTER} />}
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

            <div className="mb-6 rounded-[12px] border-[0.5px] border-rule-soft bg-paper-deep px-5 py-4 text-[13px] leading-[1.55] text-ink-soft">
              {t('sentInfo')}
            </div>

            <AuthSubmit
              type="button"
              variant="ghost"
              onClick={() => {
                setSent(false);
                setError(null);
              }}
            >
              {t('resend')}
            </AuthSubmit>

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
