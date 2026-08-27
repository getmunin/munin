'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { PageSpinner, Sheet, SheetContent, cn } from '@getmunin/ui';
import { authClient } from '../auth-client';
import { clearActiveOrgId } from '../auth/active-org';
import { useActiveRole } from '../auth/use-active-role';
import { useDashboardGate } from '../auth/use-dashboard-gate';
import { ConfirmDialogProvider } from '../components/confirm-dialog';
import { SystemAlertsBanner } from '../components/system-alerts-banner';
import { ConsoleTopbar } from '../components/munin-topbar';
import { Link, usePathname, useRouter } from '../i18n-navigation';
import { useRealtime } from '../realtime';
import {
  isConsoleItemActive,
  visibleConsoleGroups,
  type ConsoleNavCountKey,
  type ConsoleNavGroup,
} from '../nav/console-groups';

export type ConsoleNavCounts = Partial<Record<ConsoleNavCountKey, number>>;

export interface ConsoleShellProps {
  brand: string;
  groups: ConsoleNavGroup[];
  logoSrc?: string;
  orgSlot?: ReactNode;
  counts?: ConsoleNavCounts;
  roleNote?: ReactNode;
  withConfirmDialog?: boolean;
  children: ReactNode;
}

export function ConsoleShell({
  brand,
  groups,
  logoSrc = '/munin-logo.png',
  orgSlot,
  counts,
  roleNote,
  withConfirmDialog = false,
  children,
}: ConsoleShellProps) {
  const tNav = useTranslations('nav');
  const tCommon = useTranslations('common');
  const tGroups = useTranslations('dashboard.console.groups');
  const tStatus = useTranslations('dashboard.status');
  const pathname = usePathname();
  const router = useRouter();
  const { data: session } = authClient.useSession();
  const { ready } = useDashboardGate();
  const { role } = useActiveRole();
  const [menuOpen, setMenuOpen] = useState(false);
  const { status } = useRealtime([{ channel: 'org' }], () => {});

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  if (!ready || !session) {
    return <PageSpinner className="min-h-screen bg-background" />;
  }

  if (pathname.startsWith('/dashboard/settings')) {
    const settingsContent = (
      <div className="group flex min-h-screen flex-col bg-bone dark:bg-background">
        <SystemAlertsBanner />
        {children}
      </div>
    );
    return withConfirmDialog ? (
      <ConfirmDialogProvider>{settingsContent}</ConfirmDialogProvider>
    ) : (
      settingsContent
    );
  }

  const visible = visibleConsoleGroups(groups, role);
  const activeItem = visible
    .flatMap((group) => group.items)
    .find((item) => isConsoleItemActive(item.href, pathname));
  const viewLabel = activeItem ? tNav(activeItem.labelKey) : brand;

  const signOut = () => {
    void (async () => {
      await authClient.signOut();
      clearActiveOrgId();
      router.push('/login');
    })();
  };

  const navList = (variant: 'rail' | 'sheet') => (
    <nav className={variant === 'sheet' ? 'flex flex-col gap-6' : 'flex flex-col gap-6'}>
      {visible.map((group) => (
        <div key={group.groupKey}>
          <p
            className={cn(
              'font-mono uppercase tracking-eyebrow text-ink-mute dark:text-foreground/55',
              variant === 'sheet' ? 'mb-2 text-[9px]' : 'mb-2 px-5 text-[10px]',
            )}
          >
            {tGroups(group.groupKey)}
          </p>
          <div className="flex flex-col">
            {group.items.map((item) => {
              const active = isConsoleItemActive(item.href, pathname);
              const count = item.countKey ? counts?.[item.countKey] : undefined;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex items-center gap-3 border-b-[1px] border-rule-soft transition-colors duration-fast ease-munin dark:border-rule-on-dark',
                    variant === 'sheet'
                      ? 'min-h-[52px] text-base'
                      : 'border-l-2 px-5 py-2.5 text-sm',
                    variant === 'rail' &&
                      (active
                        ? 'border-l-cobalt bg-paper text-ink dark:bg-card dark:text-foreground'
                        : 'border-l-transparent text-ink-soft hover:bg-paper hover:text-ink dark:text-foreground/75 dark:hover:bg-card dark:hover:text-foreground'),
                    variant === 'sheet' &&
                      (active
                        ? 'text-cobalt dark:text-cobalt-soft'
                        : 'text-ink dark:text-foreground'),
                  )}
                >
                  {variant === 'sheet' && active ? <AttentionDot /> : null}
                  <span className="truncate">{tNav(item.labelKey)}</span>
                  {item.noteKey ? (
                    <span className="ml-auto font-mono text-[9px] uppercase tracking-meta text-ink-mute dark:text-foreground/55">
                      {tNav(item.noteKey)}
                    </span>
                  ) : count ? (
                    <span
                      className={cn(
                        'ml-auto font-mono text-[10px]',
                        active
                          ? 'text-cobalt dark:text-cobalt-soft'
                          : 'text-cobalt dark:text-cobalt-soft',
                      )}
                    >
                      {count}
                    </span>
                  ) : null}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );

  const userFooter = (
    <div className="flex items-center gap-2.5 border-t-[1px] border-rule-soft px-4 py-3.5 dark:border-rule-on-dark">
      <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-cobalt font-mono text-[8px] text-paper">
        {initials(session.user.name || session.user.email)}
      </span>
      <span className="min-w-0 truncate text-[15px] text-ink dark:text-foreground">
        {session.user.name || session.user.email}
      </span>
      <button
        type="button"
        onClick={signOut}
        className="ml-auto shrink-0 font-mono text-[9px] uppercase tracking-meta text-ink-mute transition-colors duration-fast hover:text-ink dark:text-foreground/55 dark:hover:text-foreground"
      >
        {tCommon('signOut')}
      </button>
    </div>
  );

  const content = (
    <div className="group flex min-h-screen flex-col bg-bone dark:bg-background">
      <SystemAlertsBanner />
      <div className="flex flex-1 min-h-0">
        <aside className="sticky top-0 hidden h-screen w-[280px] shrink-0 flex-col self-start border-r-[1px] border-rule-soft bg-bone md:flex dark:border-rule-on-dark dark:bg-secondary">
          <div className="flex items-center gap-3.5 px-5 py-5">
            <Link href="/dashboard" aria-label={brand} className="shrink-0">
              <Image src={logoSrc} alt={brand} width={40} height={40} priority />
            </Link>
            {orgSlot ?? (
              <span className="min-w-0 truncate text-[13px] font-medium text-ink dark:text-foreground">
                {brand}
              </span>
            )}
          </div>
          <div className="flex-1 overflow-y-auto pb-4">{navList('rail')}</div>
          <div className="mx-3.5 mb-3.5 flex items-center gap-2 border-[1px] border-rule-soft px-3 py-2.5 font-mono text-[10px] uppercase tracking-meta text-ink-soft dark:border-rule-on-dark dark:text-foreground/75">
            <span
              className={cn(
                'size-1.5 shrink-0 rounded-full',
                status === 'connected' ? 'bg-cobalt' : 'bg-ink-mute',
              )}
              aria-hidden
            />
            {tStatus(status)}
          </div>
          {userFooter}
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <ConsoleTopbar
            brand={brand}
            logoSrc={logoSrc}
            viewLabel={viewLabel}
            orgSlot={orgSlot}
            menuOpen={menuOpen}
            onMenuToggle={() => setMenuOpen((o) => !o)}
            openMenuLabel={tNav('openMenu')}
            className="md:hidden"
          />
          <main className="flex-1 overflow-x-clip bg-paper dark:bg-background">{children}</main>
        </div>
      </div>

      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side="right" className="w-full max-w-none p-0 md:hidden">
          <div className="flex h-full flex-col bg-paper dark:bg-background">
            <div className="flex h-14 shrink-0 items-center gap-2.5 border-b-[1px] border-rule-soft px-4 dark:border-rule-on-dark">
              <Image src={logoSrc} alt="" width={26} height={26} aria-hidden />
              <span className="min-w-0 truncate text-sm font-medium text-ink dark:text-foreground">
                {brand}
              </span>
            </div>
            <div className="flex flex-1 flex-col gap-6 overflow-y-auto px-4 py-5">
              {navList('sheet')}
              {roleNote ? (
                <p className="m-0 font-serif text-lg italic leading-snug text-ink-soft dark:text-foreground/75">
                  {roleNote}
                </p>
              ) : null}
            </div>
            {userFooter}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );

  return withConfirmDialog ? <ConfirmDialogProvider>{content}</ConfirmDialogProvider> : content;
}

function AttentionDot() {
  return (
    <span
      aria-hidden
      className="size-[7px] shrink-0 rounded-full bg-cobalt shadow-[0_0_0_3px_rgb(var(--munin-accent)/0.22)]"
    />
  );
}

function initials(label: string): string {
  const parts = label.trim().split(/[\s@.]+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0]!}${parts[parts.length - 1]![0]!}`.toUpperCase();
}
