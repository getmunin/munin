'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { isOwnerOrAdmin, useActiveRole } from '@getmunin/dashboard-pages';
import { PageSpinner, RailGroup, RailItem, RailNav } from '@getmunin/ui';

type GroupKey = 'workspace' | 'access' | 'monitoring';

type ItemKey =
  | 'team'
  | 'channels'
  | 'builtInAi'
  | 'apiKeys'
  | 'agents'
  | 'endUsers'
  | 'usage'
  | 'activity'
  | 'auditLog'
  | 'dataExport';

interface SubNavItem {
  href: Route;
  labelKey: ItemKey;
}

interface SubNavGroup {
  groupKey: GroupKey;
  items: SubNavItem[];
}

const GROUPS: SubNavGroup[] = [
  {
    groupKey: 'workspace',
    items: [
      { href: '/dashboard/settings/team', labelKey: 'team' },
      { href: '/dashboard/settings/channels', labelKey: 'channels' },
      { href: '/dashboard/settings/builtin-ai', labelKey: 'builtInAi' },
      { href: '/dashboard/settings/export', labelKey: 'dataExport' },
    ],
  },
  {
    groupKey: 'access',
    items: [
      { href: '/dashboard/settings/api-keys', labelKey: 'apiKeys' },
      { href: '/dashboard/settings/agents', labelKey: 'agents' },
      { href: '/dashboard/settings/end-users', labelKey: 'endUsers' },
    ],
  },
  {
    groupKey: 'monitoring',
    items: [
      { href: '/dashboard/settings/usage', labelKey: 'usage' },
      { href: '/dashboard/settings/activity', labelKey: 'activity' },
      { href: '/dashboard/settings/audit-log', labelKey: 'auditLog' },
    ],
  },
];

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const tNav = useTranslations('nav');
  const tGroups = useTranslations('dashboard.settings.groups');
  const { role, loading } = useActiveRole();

  useEffect(() => {
    if (!loading && !isOwnerOrAdmin(role)) {
      router.replace('/dashboard');
    }
  }, [loading, role, router]);

  if (loading || !isOwnerOrAdmin(role)) {
    return <PageSpinner />;
  }

  return (
    <div className="flex gap-10 px-10 py-10 max-w-7xl mx-auto">
      <RailNav>
        {GROUPS.map((group) => (
          <RailGroup key={group.groupKey} label={tGroups(group.groupKey)}>
            {group.items.map((item) => (
              <RailItem
                key={item.href}
                render={
                  <Link
                    href={item.href}
                    aria-current={pathname.startsWith(item.href) ? 'page' : undefined}
                  />
                }
                active={pathname.startsWith(item.href)}
              >
                {tNav(item.labelKey)}
              </RailItem>
            ))}
          </RailGroup>
        ))}
      </RailNav>
      <div className="flex-1 min-w-0 space-y-10">{children}</div>
    </div>
  );
}
