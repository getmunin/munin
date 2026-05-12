'use client';

import { useEffect } from 'react';
import { useRouter } from '../i18n-navigation';
import { authClient } from '../auth-client';
import { useActiveMembership } from './use-active-role';
import { useAgentConfigStatus } from './use-agent-config-status';

export function useSetupGate(): { ready: boolean } {
  const router = useRouter();
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
      router.push('/dashboard');
    }
  }, [isPending, session, configLoading, membershipLoading, setupComplete, router]);

  const ready =
    !isPending &&
    !!session &&
    !configLoading &&
    !membershipLoading &&
    setupIncomplete;

  return { ready };
}
