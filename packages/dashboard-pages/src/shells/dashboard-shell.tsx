'use client';

import type { ReactNode } from 'react';
import { PageSpinner } from '@getmunin/ui';
import { useDashboardGate } from '../auth/use-dashboard-gate';
import { SystemAlertsBanner } from '../components/system-alerts-banner';
import { SetupStateProvider } from '../components/first-run';
import { ConfirmDialogProvider } from '../components/confirm-dialog';
import { usePathname } from '../i18n-navigation';
import { ConsoleShell } from './console-shell';

export interface DashboardShellProps {
  brand: string;
  brandHref?: string;
  logoSrc?: string;
  leftSlot?: ReactNode;
  withConfirmDialog?: boolean;
  children: ReactNode;
}

export function DashboardShell({
  brand,
  brandHref,
  logoSrc = '/munin-logo.png',
  leftSlot,
  withConfirmDialog = false,
  children,
}: DashboardShellProps) {
  const pathname = usePathname();
  const { ready, signedIn } = useDashboardGate();

  const inSettings = pathname.startsWith('/dashboard/settings');

  const content = (
    <SetupStateProvider enabled={signedIn}>
      {ready ? (
        <div className="group flex h-dvh flex-col bg-bone dark:bg-background">
          <SystemAlertsBanner />
          {inSettings ? (
            <main className="min-h-0 flex-1 overflow-x-clip bg-paper dark:bg-background">
              {children}
            </main>
          ) : (
            <div className="min-h-0 flex-1">
              <ConsoleShell
                brand={brand}
                brandHref={brandHref}
                logoSrc={logoSrc}
                headSlot={leftSlot}
              >
                {children}
              </ConsoleShell>
            </div>
          )}
        </div>
      ) : (
        <PageSpinner className="min-h-screen bg-background" />
      )}
    </SetupStateProvider>
  );

  return withConfirmDialog ? <ConfirmDialogProvider>{content}</ConfirmDialogProvider> : content;
}
