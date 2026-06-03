'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { PageSpinner } from '@getmunin/ui';
import { authClient } from '../auth-client';
import { useDashboardGate } from '../auth/use-dashboard-gate';
import { SystemAlertsBanner } from '../components/system-alerts-banner';
import { ConfirmDialogProvider } from '../components/confirm-dialog';
import { DashboardTopbar } from '../components/munin-topbar';
import { usePathname } from '../i18n-navigation';

export interface DashboardShellProps {
  brand: string;
  logoSrc?: string;
  leftSlot?: ReactNode;
  withConfirmDialog?: boolean;
  children: ReactNode;
}

export function DashboardShell({
  brand,
  logoSrc = '/munin-logo.png',
  leftSlot,
  withConfirmDialog = false,
  children,
}: DashboardShellProps) {
  const tNav = useTranslations('nav');
  const pathname = usePathname();
  const { data: session } = authClient.useSession();
  const { ready } = useDashboardGate();

  if (!ready || !session) {
    return <PageSpinner className="min-h-screen bg-bone dark:bg-background" />;
  }

  const inSettings = pathname.startsWith('/dashboard/settings');

  const content = (
    <div className="group flex min-h-screen flex-col bg-bone dark:bg-background">
      <SystemAlertsBanner />
      {!inSettings && (
        <DashboardTopbar
          brand={brand}
          logoSrc={logoSrc}
          leftSlot={leftSlot}
          settingsLabel={tNav('settings')}
        />
      )}
      <main className="flex-1 overflow-x-clip bg-paper dark:bg-background">{children}</main>
    </div>
  );

  return withConfirmDialog ? <ConfirmDialogProvider>{content}</ConfirmDialogProvider> : content;
}
