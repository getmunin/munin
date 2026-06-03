'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Link } from '../../i18n-navigation';
import {
  AuthShell,
  AuthHeading,
  AuthSubheading,
} from './auth-shell';
import { AuthEpigraph } from './auth-epigraph';
import type { AuthFooter } from './epigraphs';

export interface VerifyEmailPageProps {
  footer: AuthFooter;
}

type VerifyState = 'success' | 'expired' | 'invalid';

function readState(params: URLSearchParams | null): VerifyState {
  const error = params?.get('error') ?? '';
  if (error === 'TOKEN_EXPIRED' || error === 'expired') return 'expired';
  if (error) return 'invalid';
  return 'success';
}

function VerifyEmailInner({ footer }: VerifyEmailPageProps) {
  const t = useTranslations('auth.verifyEmail');
  const params = useSearchParams();
  const state = readState(params);
  const epigraphState = state === 'success' ? 'reset-done' : 'invite-bad';
  const title = t(`${state}Title`);
  const subtitle = t(`${state}Subtitle`);
  const cta = t(`${state}Cta`);

  return (
    <AuthShell
      rightZone={<AuthEpigraph state={epigraphState} footer={footer} />}
      leftZone={
        <>
          <AuthHeading>{title}</AuthHeading>
          <AuthSubheading>{subtitle}</AuthSubheading>
          <Link
            href="/login"
            autoFocus
            className="mt-2 inline-flex w-full items-center justify-center gap-2 border-[0.5px] border-ink bg-ink px-[18px] py-4 text-[15px] font-medium text-paper transition-colors duration-fast ease-munin hover:border-cobalt-deep hover:bg-cobalt-deep active:translate-y-px"
          >
            {cta}
          </Link>
        </>
      }
    />
  );
}

export function VerifyEmailPage({ footer }: VerifyEmailPageProps) {
  return (
    <Suspense fallback={null}>
      <VerifyEmailInner footer={footer} />
    </Suspense>
  );
}
