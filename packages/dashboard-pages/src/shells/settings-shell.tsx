'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { ArrowLeft, LogOut, Menu } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { PageSpinner, Sheet, SheetContent, SheetTitle, cn } from '@getmunin/ui';
import { authClient } from '../auth-client';
import { clearActiveOrgId } from '../auth/active-org';
import { isOwnerOrAdmin, useActiveRole } from '../auth/use-active-role';
import { Link, usePathname, useRouter } from '../i18n-navigation';
import { settingsGroupsForRole, type SettingsSubNavGroup } from '../nav/settings-groups';

export interface SettingsShellProps {
  groups: SettingsSubNavGroup[];
  children: ReactNode;
}

export function SettingsShell({ groups, children }: SettingsShellProps) {
  const router = useRouter();
  const pathname = usePathname();
  const tNav = useTranslations('nav');
  const tCommon = useTranslations('common');
  const tSettings = useTranslations('dashboard.settings');
  const tGroups = useTranslations('dashboard.settings.groups');
  const { role, loading } = useActiveRole();
  const [mobileOpen, setMobileOpen] = useState(false);

  const isAdmin = isOwnerOrAdmin(role);
  const visibleGroups = settingsGroupsForRole(groups, isAdmin);
  const allowedHrefs = visibleGroups.flatMap((g) => g.items.map((i) => i.href));
  const onAllowedPage = allowedHrefs.some((href) => pathname.startsWith(href));
  const fallbackHref = allowedHrefs[0] ?? '/dashboard/conversations';

  useEffect(() => {
    if (loading || isAdmin || onAllowedPage) return;
    router.replace(fallbackHref);
  }, [loading, isAdmin, onAllowedPage, fallbackHref, router]);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  if (loading || (!isAdmin && !onAllowedPage)) {
    return <PageSpinner className="min-h-screen bg-background" />;
  }

  const backHref = isAdmin ? '/dashboard' : '/dashboard/conversations';
  const backLabel = isAdmin ? tSettings('backToOverview') : tSettings('backToConversations');

  const signOut = () => {
    void (async () => {
      await authClient.signOut();
      clearActiveOrgId();
      router.push('/login');
    })();
  };

  const backLink = (
    <Link
      href={backHref}
      className="group inline-flex items-center gap-2.5 font-mono text-[10px] uppercase tracking-eyebrow text-ink-soft transition-colors duration-fast ease-munin hover:text-cobalt dark:text-foreground/80 dark:hover:text-cobalt-soft"
    >
      <ArrowLeft
        aria-hidden
        className="relative -top-px size-[15px] transition-transform duration-base ease-munin group-hover:-translate-x-0.5"
      />
      <span>{backLabel}</span>
    </Link>
  );

  const navTree = (
    <nav className="flex flex-col gap-6 pl-2 pr-6">
      {visibleGroups.map((group) => (
        <div key={group.groupKey}>
          <p className="mb-2 px-3.5 font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute">
            {tGroups(group.groupKey)}
          </p>
          <ul className="space-y-px">
            {group.items.map((item) => {
              const active = pathname.startsWith(item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex items-center border-l-[3px] px-3.5 py-2 text-[14.5px] transition-colors duration-fast ease-munin',
                      active
                        ? 'border-cobalt bg-paper text-ink dark:border-cobalt-soft dark:bg-card dark:text-foreground'
                        : 'border-transparent text-ink-soft hover:text-ink dark:text-foreground/70 dark:hover:text-foreground',
                    )}
                  >
                    {tNav(item.labelKey)}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      {!isAdmin ? (
        <p className="px-3.5 font-mono text-[9px] uppercase leading-relaxed tracking-meta text-ink-mute">
          {tSettings('agentNote')}
        </p>
      ) : null}
    </nav>
  );

  const signOutButton = (
    <button
      type="button"
      onClick={signOut}
      className="flex w-full items-center gap-2.5 px-5 py-4 text-sm text-ink transition-colors duration-fast ease-munin hover:text-cobalt dark:text-foreground dark:hover:text-cobalt-soft"
    >
      <LogOut className="size-4" aria-hidden />
      <span>{tCommon('signOut')}</span>
    </button>
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-paper dark:bg-background">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-ink px-4 md:hidden dark:border-rule-on-dark">
        {backLink}
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label={tNav('openMenu')}
          aria-expanded={mobileOpen}
          className="ml-auto flex items-center gap-2.5 font-mono text-[9px] uppercase tracking-eyebrow text-ink-soft dark:text-foreground/80"
        >
          {tNav('settings')}
          <Menu aria-hidden className="size-4 text-ink dark:text-foreground" />
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="hidden min-h-0 w-72 shrink-0 flex-col border-r border-ink bg-bone md:flex dark:border-rule-on-dark dark:bg-secondary">
          <div className="flex flex-col gap-3 px-5 pb-5 pt-5">
            {backLink}
            <span className="font-serif text-[34px] font-normal leading-none tracking-tight text-ink dark:text-foreground">
              {tNav('settings')}
            </span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto py-2">{navTree}</div>
          <div className="border-t border-rule-soft dark:border-rule-on-dark">{signOutButton}</div>
        </aside>

        <div className="min-h-0 min-w-0 flex-1 space-y-10 overflow-y-auto bg-paper px-6 py-8 md:px-12 md:py-10 dark:bg-background">
          {children}
        </div>
      </div>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="max-w-[320px] border-0 p-0">
          <div className="flex h-full flex-col bg-bone dark:bg-secondary">
            <SheetTitle className="px-5 pb-2 pt-5 font-serif text-2xl font-normal tracking-tight text-ink dark:text-foreground">
              {tNav('settings')}
            </SheetTitle>
            <div className="min-h-0 flex-1 overflow-y-auto py-2">{navTree}</div>
            <div className="border-t border-rule-soft dark:border-rule-on-dark">{signOutButton}</div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
