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

interface CacheEntry {
  promise: Promise<OrgRole | null>;
  value: OrgRole | null | undefined;
}

let cache: CacheEntry | null = null;

function fetchActiveRole(): Promise<OrgRole | null> {
  if (cache) return cache.promise;
  const promise = api<MembershipDto[]>('/api/orgs/me/memberships').then((rows) => {
    const active = rows.find((m) => m.isDefault) ?? rows[0] ?? null;
    const role = active && isOrgRole(active.role) ? active.role : null;
    if (cache) cache.value = role;
    return role;
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

export function useActiveRole(): { role: OrgRole | null; loading: boolean; error: string | null } {
  const [role, setRole] = useState<OrgRole | null>(cache?.value ?? null);
  const [loading, setLoading] = useState(cache?.value === undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (cache?.value !== undefined) {
      setRole(cache.value);
      setLoading(false);
      return;
    }
    fetchActiveRole()
      .then((r) => {
        if (!cancelled) {
          setRole(r);
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

  return { role, loading, error };
}

export function isOwnerOrAdmin(role: OrgRole | null): boolean {
  return role === 'owner' || role === 'admin';
}
