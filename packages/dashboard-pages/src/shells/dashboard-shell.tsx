'use client';

import type { ReactNode } from 'react';
import { PageSpinner } from '@getmunin/ui';
import { authClient } from '../auth-client';
import { useDashboardGate } from '../auth/use-dashboard-gate';
import { SystemAlertsBanner } from '../components/system-alerts-banner';
import { SetupStateProvider } from '../components/first-run';
import { ConfirmDialogProvider } from '../components/confirm-dialog';
import { usePathname } from '../i18n-navigation';
import { ConsoleShell } from './console-shell';

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
  const pathname = usePathname();
  const { data: session } = authClient.useSession();
  const { ready } = useDashboardGate();

  if (!ready || !session) {
    return <PageSpinner className="min-h-screen bg-background" />;
  }

  const inSettings = pathname.startsWith('/dashboard/settings');

  const content = (
    <SetupStateProvider>
      <div className="group flex h-dvh flex-col bg-bone dark:bg-background">
        <SystemAlertsBanner />
        {inSettings ? (
          <main className="min-h-0 flex-1 overflow-x-clip bg-paper dark:bg-background">
            {children}
          </main>
        ) : (
          <div className="min-h-0 flex-1">
            <ConsoleShell brand={brand} logoSrc={logoSrc} headSlot={leftSlot}>
              {children}
            </ConsoleShell>
          </div>
        )}
      </div>
    </SetupStateProvider>
  );

  return withConfirmDialog ? <ConfirmDialogProvider>{content}</ConfirmDialogProvider> : content;
}
