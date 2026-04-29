'use client';

import { useEffect, useState } from 'react';
import { Building2, Check, ChevronDown } from 'lucide-react';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@getmunin/ui';
import { api, ApiError } from '../api';

interface MembershipDto {
  orgId: string;
  name: string;
  slug: string;
  role: string;
  isDefault: boolean;
}

/**
 * Cross-org switcher for the dashboard header. Lists every org the
 * caller is a member of via `GET /api/orgs/me/memberships`; selecting one
 * flips `is_default` server-side and reloads so the next request picks up
 * the new active org via the session-cookie credential resolver.
 */
export function OrgSwitcher() {
  const [memberships, setMemberships] = useState<MembershipDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);

  useEffect(() => {
    void api<MembershipDto[]>('/api/orgs/me/memberships')
      .then(setMemberships)
      .catch((err: unknown) =>
        setError(err instanceof ApiError ? err.message : 'Could not load orgs.'),
      );
  }, []);

  if (error) {
    return <span className="text-xs text-destructive">{error}</span>;
  }
  if (!memberships) {
    return <span className="text-xs text-muted-foreground">Loading orgs…</span>;
  }
  if (memberships.length === 0) {
    return null;
  }

  const active = memberships.find((m) => m.isDefault) ?? memberships[0]!;

  async function onSwitch(orgId: string) {
    if (orgId === active.orgId) return;
    setSwitching(orgId);
    try {
      await api('/api/orgs/me/memberships/active', {
        method: 'PATCH',
        body: JSON.stringify({ orgId }),
      });
      // Hard reload so server-side session resolution picks up the new active org.
      window.location.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not switch org.');
      setSwitching(null);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="outline" size="sm" className="gap-2 px-2 h-8" />}
      >
        <Building2 className="size-3.5 text-muted-foreground" />
        <span className="max-w-[160px] truncate text-xs font-medium">{active.name}</span>
        <ChevronDown className="size-3.5 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel className="text-xs text-muted-foreground">Your orgs</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {memberships.map((m) => (
          <DropdownMenuItem
            key={m.orgId}
            onClick={() => void onSwitch(m.orgId)}
            disabled={switching === m.orgId}
            className="flex items-center justify-between gap-2"
          >
            <div className="flex flex-col">
              <span className="text-sm">{m.name}</span>
              <span className="text-xs text-muted-foreground">
                {m.role}{switching === m.orgId ? ' · switching…' : ''}
              </span>
            </div>
            {m.orgId === active.orgId && <Check className="size-4 text-muted-foreground" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
