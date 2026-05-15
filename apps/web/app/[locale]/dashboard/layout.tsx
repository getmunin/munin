'use client';

import { DashboardShell, useActiveMembership } from '@getmunin/dashboard-pages';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { membership } = useActiveMembership();
  const brand = membership?.name?.trim() || 'Munin';

  return (
    <DashboardShell brand={brand} withConfirmDialog>
      {children}
    </DashboardShell>
  );
}
