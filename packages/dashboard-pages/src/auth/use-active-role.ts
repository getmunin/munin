'use client';

import { useEffect, useState } from 'react';
import { api } from '../api';
import { authClient } from '../auth-client';
import { getActiveOrgId } from './active-org';

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
  promise: Promise<ActiveMembership | null>;
  value: ActiveMembership | null | undefined;
}

let cache: CacheEntry | null = null;

export function invalidateActiveMembershipCache(): void {
  cache = null;
}

function fetchActiveMembership(userId: string | null): Promise<ActiveMembership | null> {
  if (cache && cache.userId === userId) return cache.promise;
  const promise = api<MembershipDto[]>('/v1/me/memberships').then((rows) => {
    const pinnedOrgId = getActiveOrgId();
    const active =
      (pinnedOrgId ? rows.find((m) => m.orgId === pinnedOrgId) : undefined) ??
      rows.find((m) => m.isDefault) ??
      rows[0] ??
      null;
    const membership: ActiveMembership | null =
      active && isOrgRole(active.role)
        ? {
            orgId: active.orgId,
            name: active.name,
            slug: active.slug,
            role: active.role,
            isDefault: active.isDefault,
          }
        : null;
    if (cache?.promise === promise) cache.value = membership;
    return membership;
  });
  cache = { userId, promise, value: undefined };
  promise.catch(() => {
    if (cache?.promise === promise) cache = null;
  });
  return promise;
}

function isOrgRole(value: string): value is OrgRole {
  return value === 'owner' || value === 'admin' || value === 'member';
}

export function useActiveMembership(): {
  membership: ActiveMembership | null;
  loading: boolean;
  error: string | null;
} {
  const { data: session, isPending } = authClient.useSession();
  const userId = session?.user?.id ?? null;
  const [membership, setMembership] = useState<ActiveMembership | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isPending) return;
    let cancelled = false;
    if (cache?.userId === userId && cache.value !== undefined) {
      setMembership(cache.value);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    fetchActiveMembership(userId)
      .then((m) => {
        if (!cancelled) {
          setMembership(m);
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
  }, [userId, isPending]);

  return { membership, loading, error };
}

export function useActiveRole(): { role: OrgRole | null; loading: boolean; error: string | null } {
  const { membership, loading, error } = useActiveMembership();
  return { role: membership?.role ?? null, loading, error };
}

export function isOwnerOrAdmin(role: OrgRole | null): boolean {
  return role === 'owner' || role === 'admin';
}
