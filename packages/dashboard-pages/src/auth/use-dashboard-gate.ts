'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from '../i18n-navigation';
import { authClient } from '../auth-client';
import { useDashboardBootstrap } from './dashboard-bootstrap';
import { isOwnerOrAdmin, useActiveMembership, type OrgRole } from './use-active-role';
import { useAgentConfigStatus } from './use-agent-config-status';

const EXEMPT_PREFIXES = ['/dashboard/account', '/dashboard/oauth/consent'];

export function useDashboardGate(): {
  ready: boolean;
  signedIn: boolean;
  role: OrgRole | null;
} {
  const router = useRouter();
  const pathname = usePathname();
  const bootstrap = useDashboardBootstrap();
  const { data: session, isPending } = authClient.useSession();
  const { membership, loading: membershipLoading } = useActiveMembership();
  const { configured, loading: configLoading } = useAgentConfigStatus();

  const role = membership?.role ?? null;
  const exempt = EXEMPT_PREFIXES.some((p) => pathname?.startsWith(p));
  const orgNamed = membership ? membership.name.trim().length > 0 : null;

  const signedIn = bootstrap !== null || (!isPending && !!session);
  const accountLoaded = !membershipLoading && !configLoading;
  const mustFinishSetup =
    (configured === false || orgNamed === false) && isOwnerOrAdmin(role);

  useEffect(() => {
    if (isPending) return;
    if (!session) {
      router.push('/login');
      return;
    }
    if (exempt || !accountLoaded) return;
    if (mustFinishSetup) {
      const search = typeof window !== 'undefined' ? window.location.search : '';
      router.push(search ? `/setup${search}` : '/setup');
    }
  }, [isPending, session, exempt, accountLoaded, mustFinishSetup, router]);

  const ready = signedIn && (exempt || (accountLoaded && !mustFinishSetup));

  return { ready, signedIn, role };
}
