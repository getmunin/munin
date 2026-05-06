'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { usePathname, useRouter } from 'next/navigation';
import {
  Activity,
  Bot,
  Download,
  Gauge,
  KeyRound,
  Loader2,
  Mail,
  MessageSquare,
  ShieldCheck,
  Users,
  UsersRound,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { isOwnerOrAdmin, useActiveRole } from '@getmunin/dashboard-pages';
import { cn } from '@getmunin/ui';

type GroupKey = 'workspace' | 'access' | 'monitoring';

type ItemKey =
  | 'team'
  | 'channels'
  | 'outreach'
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
  icon: React.ComponentType<{ className?: string }>;
}

interface SubNavGroup {
  groupKey: GroupKey;
  items: SubNavItem[];
}

const GROUPS: SubNavGroup[] = [
  {
    groupKey: 'workspace',
    items: [
      { href: '/dashboard/settings/team', labelKey: 'team', icon: UsersRound },
      { href: '/dashboard/settings/channels', labelKey: 'channels', icon: MessageSquare },
      { href: '/dashboard/settings/outreach', labelKey: 'outreach', icon: Mail },
      { href: '/dashboard/settings/export', labelKey: 'dataExport', icon: Download },
    ],
  },
  {
    groupKey: 'access',
    items: [
      { href: '/dashboard/settings/api-keys', labelKey: 'apiKeys', icon: KeyRound },
      { href: '/dashboard/settings/agents', labelKey: 'agents', icon: Bot },
      { href: '/dashboard/settings/end-users', labelKey: 'endUsers', icon: Users },
    ],
  },
  {
    groupKey: 'monitoring',
    items: [
      { href: '/dashboard/settings/usage', labelKey: 'usage', icon: Gauge },
      { href: '/dashboard/settings/activity', labelKey: 'activity', icon: Activity },
      { href: '/dashboard/settings/audit-log', labelKey: 'auditLog', icon: ShieldCheck },
    ],
  },
];

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const tNav = useTranslations('nav');
  const tGroups = useTranslations('dashboard.settings.groups');
  const tCommon = useTranslations('common');
  const { role, loading } = useActiveRole();

  useEffect(() => {
    if (!loading && !isOwnerOrAdmin(role)) {
      router.replace('/dashboard');
    }
  }, [loading, role, router]);

  if (loading || !isOwnerOrAdmin(role)) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" aria-label={tCommon('loading')} />
      </div>
    );
  }

  return (
    <div className="flex gap-8">
      <nav className="hidden w-56 shrink-0 md:block">
        <ul className="space-y-4">
          {GROUPS.map((group) => (
            <li key={group.groupKey}>
              <p className="px-3 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {tGroups(group.groupKey)}
              </p>
              <ul className="space-y-1">
                {group.items.map((item) => {
                  const active = pathname.startsWith(item.href);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className={cn(
                          'flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors',
                          active
                            ? 'bg-accent font-medium text-accent-foreground'
                            : 'text-muted-foreground hover:bg-accent/60 hover:text-accent-foreground',
                        )}
                      >
                        <item.icon className="size-4" />
                        {tNav(item.labelKey)}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      </nav>
      <div className="flex-1 min-w-0 space-y-6">{children}</div>
    </div>
  );
}
