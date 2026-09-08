'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { SetupStateDto } from '../components/first-run/setup-snapshot';
import type { ActiveMembership } from './use-active-role';

export interface DashboardBootstrap {
  membership: ActiveMembership;
  providerConfigured: boolean;
  setup: SetupStateDto;
}

const DashboardBootstrapContext = createContext<DashboardBootstrap | null>(null);

export function DashboardBootstrapProvider({
  value,
  children,
}: {
  value: DashboardBootstrap | null;
  children: ReactNode;
}) {
  return (
    <DashboardBootstrapContext.Provider value={value}>{children}</DashboardBootstrapContext.Provider>
  );
}

export function useDashboardBootstrap(): DashboardBootstrap | null {
  return useContext(DashboardBootstrapContext);
}
