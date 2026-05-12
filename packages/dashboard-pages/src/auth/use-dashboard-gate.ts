'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from '../i18n-navigation';
import { authClient } from '../auth-client';
import { isOwnerOrAdmin, useActiveMembership, useActiveRole, type OrgRole } from './use-active-role';
import { useAgentConfigStatus } from './use-agent-config-status';

const EXEMPT_PREFIXES = ['/dashboard/account', '/dashboard/oauth/consent'];

export function useDashboardGate(): { ready: boolean; role: OrgRole | null } {
  const router = useRouter();
  const pathname = usePathname();
  const { data: session, isPending } = authClient.useSession();
  const { role, loading: roleLoading } = useActiveRole();
  const { membership, loading: membershipLoading } = useActiveMembership();
  const { configured, loading: configLoading } = useAgentConfigStatus();

  const exempt = EXEMPT_PREFIXES.some((p) => pathname?.startsWith(p));
  const orgNamed = membership ? membership.name.trim().length > 0 : null;
  const setupIncomplete = configured === false || orgNamed === false;

  useEffect(() => {
    if (isPending) return;
    if (!session) {
      router.push('/login');
      return;
    }
    if (exempt) return;
    if (roleLoading || configLoading || membershipLoading) return;
    if (setupIncomplete && isOwnerOrAdmin(role)) {
      router.push('/setup');
    }
  }, [
    isPending,
    session,
    roleLoading,
    configLoading,
    membershipLoading,
    setupIncomplete,
    role,
    exempt,
    router,
  ]);

  const ready =
    !isPending &&
    !!session &&
    (exempt ||
      (!roleLoading &&
        !configLoading &&
        !membershipLoading &&
        (!setupIncomplete || !isOwnerOrAdmin(role))));

  return { ready, role };
}
