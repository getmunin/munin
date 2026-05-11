'use client';

import { useEffect } from 'react';
import { useRouter } from '../i18n-navigation';
import { authClient } from '../auth-client';
import { useAgentConfigStatus } from './use-agent-config-status';

export function useSetupGate(): { ready: boolean } {
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();
  const { configured, loading } = useAgentConfigStatus();

  useEffect(() => {
    if (isPending) return;
    if (!session) {
      router.push('/login');
      return;
    }
    if (loading) return;
    if (configured === true) {
      router.push('/dashboard');
    }
  }, [isPending, session, loading, configured, router]);

  const ready = !isPending && !!session && !loading && configured === false;

  return { ready };
}
