'use client';

import { useEffect, useState } from 'react';
import { api } from '../api';

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
  promise: Promise<ActiveMembership | null>;
  value: ActiveMembership | null | undefined;
}

let cache: CacheEntry | null = null;

function fetchActiveMembership(): Promise<ActiveMembership | null> {
  if (cache) return cache.promise;
  const promise = api<MembershipDto[]>('/api/v1/me/memberships').then((rows) => {
    const active = rows.find((m) => m.isDefault) ?? rows[0] ?? null;
    if (!active || !isOrgRole(active.role)) {
      if (cache) cache.value = null;
      return null;
    }
    const membership: ActiveMembership = {
      orgId: active.orgId,
      name: active.name,
      slug: active.slug,
      role: active.role,
      isDefault: active.isDefault,
    };
    if (cache) cache.value = membership;
    return membership;
  });
  cache = { promise, value: undefined };
  promise.catch(() => {
    cache = null;
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
  const [membership, setMembership] = useState<ActiveMembership | null>(cache?.value ?? null);
  const [loading, setLoading] = useState(cache?.value === undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (cache?.value !== undefined) {
      setMembership(cache.value);
      setLoading(false);
      return;
    }
    fetchActiveMembership()
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
  }, []);

  return { membership, loading, error };
}

export function useActiveRole(): { role: OrgRole | null; loading: boolean; error: string | null } {
  const { membership, loading, error } = useActiveMembership();
  return { role: membership?.role ?? null, loading, error };
}

export function isOwnerOrAdmin(role: OrgRole | null): boolean {
  return role === 'owner' || role === 'admin';
}
