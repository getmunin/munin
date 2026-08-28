'use client';

import Image from 'next/image';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { LogOut, Menu, X } from 'lucide-react';
import { Sheet, SheetContent, SheetTitle } from '@getmunin/ui';
import { api } from '../api';
import { authClient } from '../auth-client';
import { clearActiveOrgId } from '../auth/active-org';
import { isOwnerOrAdmin, useActiveRole } from '../auth/use-active-role';
import { Link, usePathname, useRouter } from '../i18n-navigation';
import { useRealtime, type RealtimeEventRow } from '../realtime';
import {
  consoleGroupsForRole,
  isConsoleItemActive,
  OSS_CONSOLE_GROUPS,
  type ConsoleBadge,
  type ConsoleNavGroup,
} from '../nav/console-groups';
import type { InboxQueueResponse } from '../components/dashboard/inbox-types';

interface ConsoleBadges {
  waiting: number;
  queue: number;
  learning: number;
}

const EMPTY_BADGES: ConsoleBadges = { waiting: 0, queue: 0, learning: 0 };

const REFRESH_PREFIXES = [
  'conversation.',
  'kb.',
  'crm.merge_proposal.',
  'outreach.proposal.',
  'cms.entry.',
];

function initialsOf(name: string | null | undefined, fallback: string): string {
  const src = name?.trim() || fallback;
  const parts = src.split(/[\s@._-]+/).filter(Boolean);
  const two = `${parts[0]?.[0] ?? ''}${parts[1]?.[0] ?? ''}`;
  return (two || src.slice(0, 2)).toUpperCase();
}

function useConsoleData(): { badges: ConsoleBadges } {
  const [badges, setBadges] = useState<ConsoleBadges>(EMPTY_BADGES);

  const load = useCallback(() => {
    void api<InboxQueueResponse>('/v1/inbox')
      .then((res) =>
        setBadges({
          waiting:
            res.queue.crm.length +
            res.queue.outreach.length +
            res.queue.cms.length +
            (res.queue.feedback?.length ?? 0),
          queue: res.live.length,
          learning: res.queue.kb.length,
        }),
      )
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onEvent = useCallback(
    (event: RealtimeEventRow) => {
      if (REFRESH_PREFIXES.some((prefix) => event.type.startsWith(prefix))) load();
    },
    [load],
  );
  const subscriptions = useMemo(() => [{ channel: 'org' } as const], []);
  useRealtime(subscriptions, onEvent);

  return { badges };
}

function badgeValue(badge: ConsoleBadge | undefined, badges: ConsoleBadges): number {
  if (badge === 'waiting') return badges.waiting;
  if (badge === 'queue') return badges.queue;
  if (badge === 'learning') return badges.learning;
  return 0;
}

function NavList({
  groups,
  badges,
  onNavigate,
  mobile,
}: {
  groups: ConsoleNavGroup[];
  badges: ConsoleBadges;
  onNavigate?: () => void;
  mobile?: boolean;
}) {
  const tNav = useTranslations('nav');
  const tGroups = useTranslations('dashboard.console.groups');
  const pathname = usePathname();

  return (
    <nav className={mobile ? 'flex flex-col gap-6' : 'flex flex-col gap-6 pl-2 pr-6'}>
      {groups.map((group) => (
        <div key={group.groupKey}>
          <p
            className={`mb-2 font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute ${mobile ? '' : 'px-3.5'}`}
          >
            {tGroups(group.groupKey)}
          </p>
          <ul className={mobile ? '' : 'space-y-px'}>
            {group.items.map((item) => {
              const active = isConsoleItemActive(pathname, item.href);
              const count = badgeValue(item.badge, badges);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? 'page' : undefined}
                    className={
                      mobile
                        ? `flex min-h-[52px] items-center justify-between gap-3 border-b border-rule-soft text-base dark:border-rule-on-dark ${active ? 'text-cobalt dark:text-cobalt-soft' : 'text-ink dark:text-foreground'}`
                        : `flex items-center justify-between gap-2 border-l-[3px] px-3.5 py-2 text-[14.5px] transition-colors duration-fast ease-munin ${
                            active
                              ? 'border-cobalt bg-paper text-ink dark:border-cobalt-soft dark:bg-card dark:text-foreground'
                              : 'border-transparent text-ink-soft hover:text-ink dark:text-foreground/70 dark:hover:text-foreground'
                          }`
                    }
                  >
                    <span className="truncate">{tNav(item.labelKey)}</span>
                    {count > 0 ? (
                      <span className="font-mono text-[10px] text-cobalt dark:text-cobalt-soft">
                        {count}
                      </span>
                    ) : item.trailingArrow ? (
                      <span aria-hidden className="font-mono text-base leading-none text-ink-mute">
                        →
                      </span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export interface ConsoleShellProps {
  brand: string;
  logoSrc?: string;
  headSlot?: ReactNode;
  children: ReactNode;
}

export function ConsoleShell({ brand, logoSrc = '/munin-logo.png', headSlot, children }: ConsoleShellProps) {
  const tNav = useTranslations('nav');
  const tCommon = useTranslations('common');
  const pathname = usePathname();
  const router = useRouter();
  const { data: session } = authClient.useSession();
  const { role, loading: roleLoading } = useActiveRole();
  const { badges } = useConsoleData();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!roleLoading && role && !isOwnerOrAdmin(role) && pathname === '/dashboard') {
      router.replace('/dashboard/conversations');
    }
  }, [roleLoading, role, pathname, router]);

  const groups = consoleGroupsForRole(OSS_CONSOLE_GROUPS, isOwnerOrAdmin(role));
  const activeItem = groups
    .flatMap((g) => g.items)
    .find((item) => isConsoleItemActive(pathname, item.href));

  const signOut = () => {
    void (async () => {
      await authClient.signOut();
      clearActiveOrgId();
      router.push('/login');
    })();
  };

  return (
    <div className="grid h-full min-h-0 grid-cols-1 md:grid-cols-[280px_minmax(0,1fr)]">
      <aside className="hidden min-h-0 flex-col border-r border-ink bg-bone md:flex dark:border-rule-on-dark dark:bg-secondary">
        <div className="flex items-center gap-3 px-5 pb-4 pt-5">
          <Image src={logoSrc} alt="" aria-hidden width={44} height={44} className="block size-11 object-contain" />
          <span className="min-w-0 truncate text-[15px] font-medium text-ink dark:text-foreground">
            {brand}
          </span>
        </div>
        {headSlot}
        <div className="min-h-0 flex-1 overflow-y-auto py-3">
          <NavList groups={groups} badges={badges} />
        </div>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2.5 border-b border-ink px-4 md:hidden dark:border-rule-on-dark">
          <Image src={logoSrc} alt="" aria-hidden width={26} height={26} className="block size-[26px] object-contain" />
          <span className="min-w-0 truncate text-sm font-medium text-ink dark:text-foreground">
            {brand}
          </span>
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-label={tNav('openMenu')}
            className="ml-auto flex items-center gap-2.5 font-mono text-[9px] uppercase tracking-eyebrow text-ink-soft dark:text-foreground/80"
          >
            {activeItem ? <span>{tNav(activeItem.labelKey)}</span> : null}
            <Menu aria-hidden className="size-4 text-ink dark:text-foreground" />
          </button>
        </header>

        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-clip bg-paper dark:bg-background">
          {children}
        </main>
      </div>

      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side="left" className="w-full max-w-none border-0 p-0 sm:max-w-none">
          <div className="flex h-full flex-col bg-paper dark:bg-background">
            <div className="flex h-14 shrink-0 items-center gap-2.5 border-b border-ink px-4 dark:border-rule-on-dark">
              <Image src={logoSrc} alt="" aria-hidden width={26} height={26} className="block size-[26px] object-contain" />
              <SheetTitle className="min-w-0 truncate font-sans text-sm font-medium tracking-normal text-ink dark:text-foreground">
                {brand}
              </SheetTitle>
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                aria-label={tNav('closeMenu')}
                className="ml-auto flex items-center gap-2.5 font-mono text-[9px] uppercase tracking-eyebrow text-ink-soft dark:text-foreground/80"
              >
                {tCommon('close')}
                <X aria-hidden className="size-4 text-ink dark:text-foreground" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
              <NavList groups={groups} badges={badges} mobile onNavigate={() => setMenuOpen(false)} />
            </div>
            <div className="flex shrink-0 items-center gap-2.5 border-t border-rule-soft px-4 py-3.5 dark:border-rule-on-dark">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-cobalt font-mono text-[8px] text-paper">
                {initialsOf(session?.user?.name ?? null, session?.user?.email ?? '?')}
              </span>
              <span className="min-w-0 truncate text-[15px] text-ink dark:text-foreground">
                {session?.user?.name ?? session?.user?.email}
              </span>
              <button
                type="button"
                onClick={signOut}
                className="ml-auto flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-meta text-ink-mute transition-colors duration-fast hover:text-ink dark:hover:text-foreground"
              >
                <LogOut aria-hidden className="size-3.5" />
                {tCommon('signOut')}
              </button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
