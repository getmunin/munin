'use client';

import Image from 'next/image';
import { Link } from '../i18n-navigation';
import { Settings as SettingsIcon, ArrowLeft, Menu } from 'lucide-react';
import { Button } from '@getmunin/ui';
import type { ReactNode } from 'react';

export interface DashboardTopbarProps {
  brand: string;
  brandHref?: string;
  logoSrc?: string;
  logoAlt?: string;
  settingsHref?: string;
  leftSlot?: ReactNode;
  settingsLabel: string;
}

export function DashboardTopbar({
  brand,
  brandHref = '/dashboard',
  logoSrc,
  logoAlt,
  settingsHref = '/dashboard/settings',
  leftSlot,
  settingsLabel,
}: DashboardTopbarProps) {
  return (
    <header className="sticky top-0 z-40 group-has-[.agent-banner]:top-12 flex h-14 items-stretch gap-6 border-b-[0.5px] border-ink bg-paper px-4 dark:border-rule-on-dark dark:bg-card md:px-10">
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
        {leftSlot ?? (
          <span className="text-[13px] font-medium text-ink dark:text-foreground">{brand}</span>
        )}
      </div>

      <div className="pointer-events-none absolute inset-x-0 top-0 flex h-14 items-center justify-center md:hidden">
        <span className="text-[13px] font-medium text-ink dark:text-foreground">{brand}</span>
      </div>

      <div className="ml-auto flex items-center self-center">
        <Link
          href={settingsHref}
          aria-label={settingsLabel}
          title={settingsLabel}
          className="group inline-flex size-9 items-center justify-center text-ink-mute transition-colors duration-fast hover:text-ink dark:hover:text-foreground"
        >
          <SettingsIcon
            className="size-5 transition-transform duration-300 group-hover:rotate-[30deg]"
            aria-hidden
          />
        </Link>
      </div>
    </header>
  );
}

export interface SettingsTopbarProps {
  title: string;
  backHref?: string;
  backLabel: string;
  onMenuToggle?: () => void;
  menuOpen?: boolean;
  openMenuLabel?: string;
}

export function SettingsTopbar({
  title,
  backHref = '/dashboard',
  backLabel,
  onMenuToggle,
  menuOpen = false,
  openMenuLabel,
}: SettingsTopbarProps) {
  return (
    <header className="sticky top-0 z-40 group-has-[.agent-banner]:top-12 flex h-14 items-stretch gap-4 border-b-[0.5px] border-ink bg-paper px-4 dark:border-rule-on-dark dark:bg-card md:gap-5 md:px-10">
      <Link
        href={backHref}
        aria-label={backLabel}
        title={backLabel}
        className="group inline-flex items-center gap-2.5 self-center px-1 py-1.5 font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute transition-colors duration-fast hover:text-ink dark:hover:text-foreground"
      >
        <ArrowLeft
          aria-hidden
          className="size-[18px] transition-transform duration-200 group-hover:-translate-x-0.5"
        />
        <span className="hidden sm:inline">{backLabel}</span>
      </Link>

      <span className="my-auto hidden h-5 w-px bg-rule-soft md:block dark:bg-rule-on-dark" aria-hidden />

      <h1 className="self-center truncate font-serif text-lg font-normal leading-tight tracking-tight text-ink md:text-xl dark:text-foreground">
        {title}
      </h1>

      <div className="ml-auto flex h-full items-center">
        {onMenuToggle ? (
          <Button
            variant="outline"
            size="icon"
            onClick={onMenuToggle}
            aria-label={openMenuLabel ?? 'Open menu'}
            aria-expanded={menuOpen}
            className="md:hidden"
          >
            <Menu className="size-4" />
          </Button>
        ) : null}
      </div>
    </header>
  );
}
