'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { authClient } from '../auth-client';
import { isOwnerOrAdmin, useActiveRole, type OrgRole } from './use-active-role';
import { useAgentConfigStatus } from './use-agent-config-status';

const EXEMPT_PREFIXES = ['/dashboard/account', '/dashboard/oauth/consent'];

export function useDashboardGate(): { ready: boolean; role: OrgRole | null } {
  const router = useRouter();
  const pathname = usePathname();
  const { data: session, isPending } = authClient.useSession();
  const { role, loading: roleLoading } = useActiveRole();
  const { configured, loading: configLoading } = useAgentConfigStatus();

  const exempt = EXEMPT_PREFIXES.some((p) => pathname?.startsWith(p));

  useEffect(() => {
    if (isPending) return;
    if (!session) {
      router.push('/login');
      return;
    }
    if (exempt) return;
    if (roleLoading || configLoading) return;
    if (configured === false && isOwnerOrAdmin(role)) {
      router.push('/setup');
    }
  }, [
    isPending,
    session,
    roleLoading,
    configLoading,
    configured,
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
        (configured === true || !isOwnerOrAdmin(role))));

  return { ready, role };
}
