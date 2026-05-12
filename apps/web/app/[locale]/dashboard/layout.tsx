'use client';

import { useTranslations } from 'next-intl';
import { usePathname } from '@/i18n/navigation';
import {
  authClient,
  ConfirmDialogProvider,
  DashboardTopbar,
  useActiveMembership,
  useDashboardGate,
} from '@getmunin/dashboard-pages';
import { PageSpinner } from '@getmunin/ui';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const tNav = useTranslations('nav');
  const pathname = usePathname();
  const { data: session } = authClient.useSession();
  const { ready } = useDashboardGate();
  const { membership } = useActiveMembership();

  if (!ready || !session) {
    return <PageSpinner className="min-h-screen bg-bone dark:bg-background" />;
  }

  const inSettings = pathname.startsWith('/dashboard/settings');

  return (
    <ConfirmDialogProvider>
      <div className="flex min-h-screen flex-col bg-bone dark:bg-background">
        {!inSettings && (
          <DashboardTopbar
            brand={membership?.name?.trim() || 'Munin'}
            logoSrc="/munin-logo.png"
            settingsLabel={tNav('settings')}
          />
        )}
        <main className="flex-1 bg-paper dark:bg-background">{children}</main>
      </div>
    </ConfirmDialogProvider>
  );
}
