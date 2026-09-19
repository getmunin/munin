'use client';

import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { isOrgId } from '@getmunin/types';

const OrgRouteContext = createContext<string | null>(null);

let currentRouteOrgId: string | null = null;

export function readRouteOrgId(): string | null {
  return currentRouteOrgId;
}

export function OrgRouteProvider({ orgId, children }: { orgId: string; children: ReactNode }) {
  const value = isOrgId(orgId) ? orgId : null;
  currentRouteOrgId = value;

  useEffect(() => {
    currentRouteOrgId = value;
    return () => {
      if (currentRouteOrgId === value) currentRouteOrgId = null;
    };
  }, [value]);

  return <OrgRouteContext.Provider value={value}>{children}</OrgRouteContext.Provider>;
}

export function useRouteOrgId(): string | null {
  return useContext(OrgRouteContext);
}
