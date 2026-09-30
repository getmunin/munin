'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '../../i18n-navigation';
import { authClient } from '../../auth-client';
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

type VerifyState = 'success' | 'expired' | 'invalid' | 'pending';

const CTA_CLASS =
  'mt-2 inline-flex w-full items-center justify-center gap-2 border-[1px] border-ink bg-ink px-[18px] py-4 text-[15px] font-medium text-paper transition-colors duration-fast ease-munin hover:border-cobalt-deep hover:bg-cobalt-deep active:translate-y-px';

function readState(params: URLSearchParams | null): VerifyState {
  if (params?.get('state') === 'pending') return 'pending';
  const error = params?.get('error') ?? '';
  if (error === 'TOKEN_EXPIRED' || error === 'expired') return 'expired';
  if (error) return 'invalid';
  return 'success';
}

function VerifyEmailInner({ footer }: VerifyEmailPageProps) {
  const t = useTranslations('auth.verifyEmail');
  const params = useSearchParams();
  const router = useRouter();
  const state = readState(params);
  const epigraphState =
    state === 'success' ? 'reset-done' : state === 'pending' ? 'invite' : 'invite-bad';
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
          {state === 'pending' ? (
            <button
              type="button"
              autoFocus
              className={CTA_CLASS}
              onClick={() => {
                void (async () => {
                  await authClient.signOut();
                  router.push('/login');
                })();
              }}
            >
              {cta}
            </button>
          ) : (
            <Link href="/login" autoFocus className={CTA_CLASS}>
              {cta}
            </Link>
          )}
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
