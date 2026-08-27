'use client';

import { useTranslations } from 'next-intl';
import { DashboardShell, isOwnerOrAdmin, useActiveMembership } from '@getmunin/dashboard-pages';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { membership } = useActiveMembership();
  const tNav = useTranslations('nav');
  const brand = membership?.name?.trim() || 'Munin';
  const isAgent = membership != null && !isOwnerOrAdmin(membership.role);

  return (
    <DashboardShell brand={brand} roleNote={isAgent ? tNav('agentScopeNote') : undefined} withConfirmDialog>
      {children}
    </DashboardShell>
  );
}
