'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import type { Route } from 'next';
import { useEffect, useState, type ReactNode } from 'react';
import { Menu, X } from 'lucide-react';
import { Sheet, SheetContent, cn } from '@getmunin/ui';
import type { RealtimeStatus } from '../realtime';

export interface MuninTopbarNavItem {
  href: Route;
  label: string;
  exact?: boolean;
  meta?: ReactNode;
  mobileSubNav?: ReactNode;
}

export interface MuninTopbarStatus {
  value: RealtimeStatus;
  label: string;
}

export interface MuninTopbarProps {
  brand: string;
  brandHref?: Route;
  logoSrc?: string;
  logoAlt?: string;
  navItems: MuninTopbarNavItem[];
  status?: MuninTopbarStatus;
  leftSlot?: ReactNode;
  rightSlot?: ReactNode;
  mobileMenuLabels?: {
    open: string;
    close: string;
    organization: string;
  };
}

const DEFAULT_MOBILE_LABELS = {
  open: 'Open menu',
  close: 'Close menu',
  organization: 'Organization',
};

export function MuninTopbar({
  brand,
  brandHref = '/dashboard',
  logoSrc,
  logoAlt,
  navItems,
  status,
  leftSlot,
  rightSlot,
  mobileMenuLabels,
}: MuninTopbarProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const labels = { ...DEFAULT_MOBILE_LABELS, ...mobileMenuLabels };

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  return (
    <>
      <header className="relative flex h-14 items-stretch gap-6 border-b border-ink bg-paper px-4 dark:border-rule-on-dark dark:bg-card md:px-10">
        <Link
          href={brandHref}
          className="flex items-center gap-1 self-center text-ink dark:text-foreground"
          aria-label={brand}
        >
          {logoSrc ? (
            <Image src={logoSrc} alt={logoAlt ?? brand} width={28} height={28} className="block" priority />
          ) : null}
        </Link>

        <span className="my-auto hidden h-5 w-px bg-rule-soft md:block dark:bg-rule-on-dark" aria-hidden />

        <div className="hidden items-center gap-3 self-center md:flex">
          <span className="text-[13px] font-medium text-ink dark:text-foreground">{brand}</span>
          {leftSlot}
        </div>

        <nav className="absolute inset-y-0 left-1/2 hidden -translate-x-1/2 items-stretch md:flex">
          {navItems.map((item) => {
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
                {item.label}
                {item.meta != null ? (
                  <span
                    className={cn(
                      'font-mono text-[10px] tracking-eyebrow',
                      active ? 'text-cobalt dark:text-cobalt-soft' : 'text-ink-mute',
                    )}
                  >
                    {item.meta}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto hidden items-center gap-3 self-center md:flex">
          {status ? (
            <span
              className="hidden items-center gap-2 font-mono text-[9px] uppercase tracking-eyebrow text-ink-mute md:flex"
              aria-live="polite"
            >
              <span
                aria-hidden
                className={cn(
                  'size-1.5 rounded-full',
                  status.value === 'connected'
                    ? 'bg-cobalt dark:bg-cobalt-soft'
                    : status.value === 'connecting'
                      ? 'bg-ink-mute animate-pulse'
                      : 'bg-destructive',
                )}
              />
              {status.label}
            </span>
          ) : null}
          {rightSlot}
        </div>

        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label={labels.open}
          className="ml-auto inline-flex size-9 items-center justify-center self-center border border-ink text-ink transition-colors hover:bg-paper-deep md:hidden dark:border-rule-on-dark dark:text-foreground"
        >
          <Menu className="size-4" />
        </button>
      </header>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="max-w-[320px]">
          <div className="flex items-start justify-between gap-4 border-b border-rule-soft px-6 py-5 dark:border-rule-on-dark">
            <div className="min-w-0">
              <p className="font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute">
                {labels.organization}
              </p>
              <p className="mt-1 truncate font-serif text-xl leading-tight text-ink dark:text-foreground">
                {brand}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              aria-label={labels.close}
              className="inline-flex size-9 shrink-0 items-center justify-center border border-ink text-ink transition-colors hover:bg-paper-deep dark:border-rule-on-dark dark:text-foreground"
            >
              <X className="size-4" />
            </button>
          </div>

          <nav className="flex-1 overflow-y-auto px-2 py-4">
            <ul className="space-y-1">
              {navItems.map((item) => {
                const matches = item.exact ? pathname === item.href : pathname.startsWith(item.href);
                const active = matches && (!item.mobileSubNav || pathname === item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'flex items-center justify-between gap-2 border-l-2 px-4 py-2.5 text-base transition-colors',
                        active
                          ? 'border-cobalt bg-paper-deep font-medium text-ink dark:border-cobalt-soft dark:bg-secondary dark:text-foreground'
                          : 'border-transparent text-ink-soft hover:bg-paper-deep hover:text-ink dark:hover:bg-secondary dark:hover:text-foreground',
                      )}
                    >
                      <span>{item.label}</span>
                      {item.mobileSubNav ? (
                        <span aria-hidden className="text-ink-mute">−</span>
                      ) : null}
                    </Link>
                    {item.mobileSubNav ? (
                      <div className="bg-paper-deep dark:bg-secondary">
                        {item.mobileSubNav}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </nav>

          <div className="border-t border-rule-soft px-6 py-4 dark:border-rule-on-dark">
            {status ? (
              <span
                className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-eyebrow text-ink-mute"
                aria-live="polite"
              >
                <span
                  aria-hidden
                  className={cn(
                    'size-1.5 rounded-full',
                    status.value === 'connected'
                      ? 'bg-cobalt dark:bg-cobalt-soft'
                      : status.value === 'connecting'
                        ? 'bg-ink-mute animate-pulse'
                        : 'bg-destructive',
                  )}
                />
                {status.label}
              </span>
            ) : null}
            {rightSlot ? <div className="mt-3 flex items-center gap-3">{rightSlot}</div> : null}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
