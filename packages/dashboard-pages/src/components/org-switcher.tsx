'use client';

import { useEffect, useState } from 'react';
import { Building2, Check, ChevronDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@getmunin/ui';
import { api } from '../api';
import { useTranslateError } from '../i18n/translate-error';

interface MembershipDto {
  orgId: string;
  name: string;
  slug: string;
  role: string;
  isDefault: boolean;
}

export function OrgSwitcher() {
  const t = useTranslations('dashboard.orgSwitcher');
  const translate = useTranslateError();
  const [memberships, setMemberships] = useState<MembershipDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);

  useEffect(() => {
    void api<MembershipDto[]>('/api/orgs/me/memberships')
      .then(setMemberships)
      .catch((err: unknown) => setError(translate(err) || t('errors.load')));
  }, [t, translate]);

  if (error) {
    return <span className="text-xs text-destructive">{error}</span>;
  }
  if (!memberships) {
    return <span className="text-xs text-muted-foreground">{t('loading')}</span>;
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
      window.location.reload();
    } catch (err) {
      setError(translate(err) || t('errors.switch'));
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
        <DropdownMenuLabel className="text-xs text-muted-foreground">{t('yourOrgs')}</DropdownMenuLabel>
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
                {m.role}
                {switching === m.orgId ? t('switching') : ''}
              </span>
            </div>
            {m.orgId === active.orgId && <Check className="size-4 text-muted-foreground" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
