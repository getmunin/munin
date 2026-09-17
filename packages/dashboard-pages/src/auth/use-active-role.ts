'use client';

import { useEffect, useState } from 'react';
import { api } from '../api';
import { authClient } from '../auth-client';
import { getActiveOrgId } from './active-org';
import { useDashboardBootstrap } from './dashboard-bootstrap';

export type OrgRole = 'owner' | 'admin' | 'member';

interface MembershipDto {
  orgId: string;
  name: string;
  slug: string;
  role: string;
  isDefault: boolean;
}

export interface ActiveMembership {
  orgId: string;
  name: string;
  slug: string;
  role: OrgRole;
  isDefault: boolean;
}

interface CacheEntry {
  userId: string | null;
  promise: Promise<MembershipDto[]>;
  rows: MembershipDto[] | undefined;
}

let cache: CacheEntry | null = null;

export function invalidateActiveMembershipCache(): void {
  cache = null;
}

function fetchMemberships(userId: string | null): Promise<MembershipDto[]> {
  if (cache && cache.userId === userId) return cache.promise;
  const promise = api<MembershipDto[]>('/v1/me/memberships').then((rows) => {
    if (cache?.promise === promise) cache.rows = rows;
    return rows;
  });
  cache = { userId, promise, rows: undefined };
  promise.catch(() => {
    if (cache?.promise === promise) cache = null;
  });
  return promise;
}

function toMembership(row: MembershipDto | undefined): ActiveMembership | null {
  if (!row || !isOrgRole(row.role)) return null;
  return {
    orgId: row.orgId,
    name: row.name,
    slug: row.slug,
    role: row.role,
    isDefault: row.isDefault,
  };
}

function selectPinned(rows: MembershipDto[]): ActiveMembership | null {
  const pinnedOrgId = getActiveOrgId();
  const pinned = pinnedOrgId ? rows.find((m) => m.orgId === pinnedOrgId) : undefined;
  return toMembership(pinned ?? rows.find((m) => m.isDefault) ?? rows[0]);
}

function selectDefault(rows: MembershipDto[]): ActiveMembership | null {
  return toMembership(rows.find((m) => m.isDefault) ?? rows[0]);
}

function isOrgRole(value: string): value is OrgRole {
  return value === 'owner' || value === 'admin' || value === 'member';
}

function useMembership(select: (rows: MembershipDto[]) => ActiveMembership | null): {
  membership: ActiveMembership | null;
  loading: boolean;
  error: string | null;
} {
  const bootstrap = useDashboardBootstrap();
  const seeded = bootstrap !== null;
  const { data: session, isPending } = authClient.useSession();
  const userId = session?.user?.id ?? null;
  const [membership, setMembership] = useState<ActiveMembership | null>(
    bootstrap?.membership ?? null,
  );
  const [loading, setLoading] = useState(!seeded);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isPending) return;
    let cancelled = false;
    if (cache?.userId === userId && cache.rows !== undefined) {
      setMembership(select(cache.rows));
      setLoading(false);
      return;
    }
    if (!seeded) setLoading(true);
    setError(null);
    fetchMemberships(userId)
      .then((rows) => {
        if (!cancelled) {
          setMembership(select(rows));
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'unknown error');
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [userId, isPending, seeded, select]);

  return { membership, loading, error };
}

export function useActiveMembership(): {
  membership: ActiveMembership | null;
  loading: boolean;
  error: string | null;
} {
  return useMembership(selectPinned);
}

export function useDefaultMembership(): {
  membership: ActiveMembership | null;
  loading: boolean;
  error: string | null;
} {
  return useMembership(selectDefault);
}

export function useActiveRole(): { role: OrgRole | null; loading: boolean; error: string | null } {
  const { membership, loading, error } = useActiveMembership();
  return { role: membership?.role ?? null, loading, error };
}

export function isOwnerOrAdmin(role: OrgRole | null): boolean {
  return role === 'owner' || role === 'admin';
}
