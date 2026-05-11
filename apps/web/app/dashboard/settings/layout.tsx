'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { isOwnerOrAdmin, useActiveRole } from '@getmunin/dashboard-pages';
import { PageSpinner, RailGroup, RailItem, RailNav } from '@getmunin/ui';
import { SETTINGS_GROUPS } from '../nav-config';

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
    <div className="flex min-h-[calc(100vh-3.5rem)]">
      <aside className="hidden md:flex md:flex-col w-72 shrink-0 bg-bone border-r border-rule-soft dark:bg-secondary dark:border-rule-on-dark py-10 px-6">
        <RailNav className="w-full">
          {SETTINGS_GROUPS.map((group) => (
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
      </aside>
      <div className="flex-1 min-w-0 px-12 py-10 space-y-10">{children}</div>
    </div>
  );
}
