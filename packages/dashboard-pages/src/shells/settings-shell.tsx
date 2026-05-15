'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { LogOut } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  PageSpinner,
  RailGroup,
  RailItem,
  RailNav,
  Sheet,
  SheetContent,
} from '@getmunin/ui';
import { authClient } from '../auth-client';
import { isOwnerOrAdmin, useActiveRole } from '../auth/use-active-role';
import { SettingsTopbar } from '../components/munin-topbar';
import { Link, usePathname, useRouter } from '../i18n-navigation';
import type { SettingsSubNavGroup } from '../nav/settings-groups';

export interface SettingsShellProps {
  groups: SettingsSubNavGroup[];
  children: ReactNode;
}

export function SettingsShell({ groups, children }: SettingsShellProps) {
  const router = useRouter();
  const pathname = usePathname();
  const tNav = useTranslations('nav');
  const tCommon = useTranslations('common');
  const tGroups = useTranslations('dashboard.settings.groups');
  const { role, loading } = useActiveRole();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (!loading && !isOwnerOrAdmin(role)) {
      router.replace('/dashboard');
    }
  }, [loading, role, router]);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  if (loading || !isOwnerOrAdmin(role)) {
    return <PageSpinner />;
  }

  const signOut = () => {
    void (async () => {
      await authClient.signOut();
      router.push('/login');
    })();
  };

  const navTree = (
    <RailNav className="block w-full">
      {groups.map((group) => (
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
  );

  const signOutButton = (
    <button
      type="button"
      onClick={signOut}
      className="flex w-full items-center gap-2 px-6 py-3 text-sm text-ink-soft transition-colors hover:bg-paper hover:text-ink dark:text-foreground/80 dark:hover:bg-card dark:hover:text-foreground"
    >
      <LogOut className="size-4" aria-hidden />
      <span>{tCommon('signOut')}</span>
    </button>
  );

  return (
    <div className="flex min-h-screen flex-col bg-paper dark:bg-background">
      <SettingsTopbar
        title={tNav('settings')}
        backLabel={tCommon('back')}
        onMenuToggle={() => setMobileOpen((o) => !o)}
        menuOpen={mobileOpen}
        openMenuLabel={tNav('openMenu')}
      />

      <div className="flex min-h-[calc(100vh-3.5rem)]">
        <aside className="hidden w-72 shrink-0 flex-col border-r-[0.5px] border-rule-soft bg-bone md:flex dark:border-rule-on-dark dark:bg-secondary">
          <div className="flex-1 overflow-y-auto px-6 py-10">{navTree}</div>
          <div className="border-t-[0.5px] border-rule-soft dark:border-rule-on-dark">
            {signOutButton}
          </div>
        </aside>

        <div className="flex-1 min-w-0 space-y-10 bg-paper px-6 py-8 md:px-12 md:py-10 dark:bg-background">
          {children}
        </div>
      </div>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="max-w-[320px] p-0">
          <div className="flex h-full flex-col">
            <div className="flex-1 overflow-y-auto px-6 py-8">{navTree}</div>
            <div className="border-t-[0.5px] border-rule-soft dark:border-rule-on-dark">
              {signOutButton}
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
