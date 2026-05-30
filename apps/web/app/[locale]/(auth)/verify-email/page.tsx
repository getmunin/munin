'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';
import {
  AuthShell,
  AuthEpigraph,
  AuthHeading,
  AuthSubheading,
  OSS_AUTH_FOOTER,
} from '@getmunin/dashboard-pages';

type VerifyState = 'success' | 'expired' | 'invalid';

function readState(params: URLSearchParams | null): VerifyState {
  const error = params?.get('error') ?? '';
  if (error === 'TOKEN_EXPIRED' || error === 'expired') return 'expired';
  if (error) return 'invalid';
  return 'success';
}

function VerifyEmailInner() {
  const t = useTranslations('auth.verifyEmail');
  const params = useSearchParams();
  const state = readState(params);
  const epigraphState = state === 'success' ? 'reset-done' : 'invite-bad';
  const title = t(`${state}Title`);
  const subtitle = t(`${state}Subtitle`);
  const cta = t(`${state}Cta`);

  return (
    <AuthShell
      rightZone={<AuthEpigraph state={epigraphState} footer={OSS_AUTH_FOOTER} />}
      leftZone={
        <>
          <AuthHeading>{title}</AuthHeading>
          <AuthSubheading>{subtitle}</AuthSubheading>
          <Link
            href="/login"
            className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-[12px] border-[0.5px] border-auth-navy bg-auth-navy px-[18px] py-4 text-[15px] font-medium text-white transition-colors duration-fast ease-munin hover:border-auth-navy-hover hover:bg-auth-navy-hover"
          >
            {cta}
          </Link>
        </>
      }
    />
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={null}>
      <VerifyEmailInner />
    </Suspense>
  );
}
