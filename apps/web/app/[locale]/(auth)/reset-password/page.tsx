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

function ResetPasswordInner() {
  const t = useTranslations('auth.resetPassword');
  const tFields = useTranslations('auth.fields');
  const router = useRouter();
  const params = useSearchParams();
  const token = params?.get('token') ?? '';
  const email = params?.get('email') ?? '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(token ? null : t('missingToken'));

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (password.length < 10) {
      setError(t('tooShort'));
      return;
    }
    if (password !== confirm) {
      setError(t('mismatch'));
      return;
    }
    setSubmitting(true);
    const res = await authClient.resetPassword({ newPassword: password, token });
    setSubmitting(false);
    if (res.error) {
      setError(t('failed'));
      return;
    }
    setSuccess(true);
    setTimeout(() => router.push('/login'), 1500);
  }

  if (success) {
    return (
      <AuthShell
        rightZone={<AuthEpigraph state="reset-done" footer={OSS_AUTH_FOOTER} />}
        leftZone={
          <>
            <AuthHeading>
              {t('doneTitleRichPre')}
              <em className="text-auth-navy not-italic font-serif italic">
                {t('doneTitleRichEm')}
              </em>
              {t('doneTitleRichPost')}
            </AuthHeading>
            <AuthSubheading>{t('doneSubtitle')}</AuthSubheading>
            <Link
              href="/login"
              className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-[12px] border-[0.5px] border-auth-navy bg-auth-navy px-[18px] py-4 text-[15px] font-medium text-white transition-colors duration-fast ease-munin hover:border-auth-navy-hover hover:bg-auth-navy-hover"
            >
              {t('doneCta')}
            </Link>
          </>
        }
      />
    );
  }

  return (
    <AuthShell
      rightZone={<AuthEpigraph state="reset" footer={OSS_AUTH_FOOTER} />}
      leftZone={
        <>
          <AuthHeading>
            {t('titleRichPre')}
            <em className="text-auth-navy not-italic font-serif italic">
              {t('titleRichEm')}
            </em>
            {t('titleRichPost')}
          </AuthHeading>
          <AuthSubheading>
            {email ? t('subtitle', { email }) : t('subtitleNoEmail')}
          </AuthSubheading>

          {error && <ErrorAlert title={error} />}

          <form onSubmit={(e) => void onSubmit(e)}>
            <AuthField>
              <AuthLabel htmlFor="rs-pw">{tFields('newPassword')}</AuthLabel>
              <AuthInput
                id="rs-pw"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="new-password"
                minLength={10}
                placeholder="••••••••••"
              />
            </AuthField>
            <AuthField>
              <AuthLabel htmlFor="rs-pw2">{tFields('confirmPassword')}</AuthLabel>
              <AuthInput
                id="rs-pw2"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                autoComplete="new-password"
                minLength={10}
                placeholder="••••••••••"
              />
            </AuthField>

            <ul className="-mt-1 mb-[18px] flex list-none flex-col gap-1.5 p-0 font-mono text-[11px] tracking-wide text-ink-mute">
              <li>
                <span className="mr-1.5">·</span>
                {t('rules.length')}
              </li>
              <li>
                <span className="mr-1.5">·</span>
                {t('rules.numberOrSymbol')}
              </li>
              <li>
                <span className="mr-1.5">·</span>
                {t('rules.notPrevious')}
              </li>
            </ul>

            <AuthSubmit type="submit" disabled={submitting || !token}>
              {submitting ? t('submitting') : t('submit')}
            </AuthSubmit>
          </form>

          <AuthFootnote>
            <Link
              href="/login"
              className="text-ink underline underline-offset-[3px] decoration-1"
            >
              {t('signIn')}
            </Link>
          </AuthFootnote>
        </>
      }
    />
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordInner />
    </Suspense>
  );
}
