'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import type { Route } from 'next';
import { useTranslations } from 'next-intl';
import { isOwnerOrAdmin, type OrgRole } from '@getmunin/dashboard-pages';
import { cn } from '@getmunin/ui';
import { LocaleSwitcher } from './locale-switcher';
import { UserMenu } from './user-menu';

type NavLabelKey = 'overview' | 'inbox' | 'settings';

interface NavItem {
  href: Route;
  labelKey: NavLabelKey;
  ownerOrAdminOnly?: boolean;
  exact?: boolean;
}

const NAV: NavItem[] = [
  { href: '/dashboard', labelKey: 'overview', exact: true },
  { href: '/dashboard/inbox', labelKey: 'inbox' },
  { href: '/dashboard/settings', labelKey: 'settings', ownerOrAdminOnly: true },
];

interface MuninTopbarProps {
  role: OrgRole | null;
  user: {
    email: string;
    name: string;
    image: string | null;
  };
  onSignOut: () => void;
  inboxCount?: number;
  status?: 'connected' | 'connecting' | 'offline';
}

export function MuninTopbar({ role, user, onSignOut, inboxCount, status = 'connected' }: MuninTopbarProps) {
  const pathname = usePathname();
  const tNav = useTranslations('nav');
  const tCommon = useTranslations('common');
  const tStatus = useTranslations('dashboard.status');
  const visibleNav = NAV.filter((item) => !item.ownerOrAdminOnly || isOwnerOrAdmin(role));

  return (
    <header className="relative flex h-14 items-stretch gap-6 border-b border-ink bg-paper px-10 dark:border-rule-on-dark dark:bg-card">
      <Link
        href="/dashboard"
        className="flex items-center gap-1 self-center text-ink dark:text-foreground"
        aria-label="Munin"
      >
        <Image src="/raven-flying.svg" alt="Munin" width={28} height={28} className="block dark:invert" priority />
      </Link>

      <span className="my-auto h-5 w-px bg-rule-soft dark:bg-rule-on-dark" aria-hidden />

      <div className="flex items-center gap-2 self-center">
        <span className="text-[13px] font-medium text-ink dark:text-foreground">Munin</span>
      </div>

      <nav className="absolute inset-y-0 left-1/2 flex -translate-x-1/2 items-stretch">
        {visibleNav.map((item) => {
          const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'inline-flex items-center gap-1.5 px-5 text-[13px] -mb-px border-b-2 border-transparent transition-colors duration-fast ease-munin',
                active
                  ? 'border-cobalt bg-paper-deep font-medium text-ink dark:bg-secondary dark:text-foreground dark:border-cobalt-soft'
                  : 'text-ink-mute hover:bg-paper-deep hover:text-ink hover:border-ink dark:hover:bg-secondary dark:hover:text-foreground dark:hover:border-foreground',
              )}
            >
              {tNav(item.labelKey)}
              {item.labelKey === 'inbox' && inboxCount != null ? (
                <span
                  className={cn(
                    'font-mono text-[10px] tracking-eyebrow',
                    active ? 'text-cobalt dark:text-cobalt-soft' : 'text-ink-mute',
                  )}
                >
                  {String(inboxCount).padStart(2, '0')}
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>

      <div className="ml-auto flex items-center gap-3 self-center">
        <span
          className="hidden items-center gap-2 font-mono text-[9px] uppercase tracking-eyebrow text-ink-mute md:flex"
          aria-live="polite"
        >
          <span
            aria-hidden
            className={cn(
              'size-1.5 rounded-full',
              status === 'connected'
                ? 'bg-cobalt dark:bg-cobalt-soft'
                : status === 'connecting'
                ? 'bg-ink-mute animate-pulse'
                : 'bg-destructive',
            )}
          />
          {tStatus(status)}
        </span>
        <LocaleSwitcher />
        <UserMenu
          email={user.email}
          name={user.name}
          image={user.image}
          signOutLabel={tCommon('signOut')}
          onSignOut={onSignOut}
        />
      </div>
    </header>
  );
}
