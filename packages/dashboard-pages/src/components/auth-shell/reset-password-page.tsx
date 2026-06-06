'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { authClient } from '../../auth-client';
import { Link, useRouter } from '../../i18n-navigation';
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

export interface ResetPasswordPageProps {
  footer: AuthFooter;
}

function ResetPasswordInner({ footer }: ResetPasswordPageProps) {
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
        rightZone={<AuthEpigraph state="reset-done" footer={footer} />}
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
              autoFocus
              className="mt-2 inline-flex w-full items-center justify-center gap-2 bg-ink px-[18px] py-4 text-[15px] font-medium text-paper shadow-[inset_0_0_0_0.5px_rgb(var(--munin-ink))] transition-colors duration-fast ease-munin hover:bg-cobalt-deep hover:shadow-[inset_0_0_0_0.5px_rgb(var(--munin-accent-deep))] active:translate-y-px"
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
      rightZone={<AuthEpigraph state="reset" footer={footer} />}
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

export function ResetPasswordPage({ footer }: ResetPasswordPageProps) {
  return (
    <Suspense fallback={null}>
      <ResetPasswordInner footer={footer} />
    </Suspense>
  );
}
