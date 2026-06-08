'use client';

import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { useRouter } from '../i18n-navigation';
import { authClient } from '../auth-client';
import { useActiveMembership } from './use-active-role';
import { useAgentConfigStatus } from './use-agent-config-status';
import { hasOauthAuthorizeParams } from './post-signin-redirect';

export function useSetupGate(): { ready: boolean } {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session, isPending } = authClient.useSession();
  const { configured, loading: configLoading } = useAgentConfigStatus();
  const { membership, loading: membershipLoading } = useActiveMembership();

  const orgNamed = membership ? membership.name.trim().length > 0 : null;
  const setupComplete = configured === true && orgNamed === true;
  const setupIncomplete = configured === false || orgNamed === false;

  useEffect(() => {
    if (isPending) return;
    if (!session) {
      router.push('/login');
      return;
    }
    if (configLoading || membershipLoading) return;
    if (setupComplete) {
      if (searchParams && hasOauthAuthorizeParams(searchParams)) {
        router.push(`/dashboard/oauth/consent?${searchParams.toString()}`);
      } else {
        router.push('/dashboard');
      }
    }
  }, [isPending, session, configLoading, membershipLoading, setupComplete, router, searchParams]);

  const ready =
    !isPending &&
    !!session &&
    !configLoading &&
    !membershipLoading &&
    setupIncomplete;

  return { ready };
}
