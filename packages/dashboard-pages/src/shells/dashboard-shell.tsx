'use client';

import type { ReactNode } from 'react';
import { ConsoleShell, type ConsoleNavCounts } from './console-shell';
import { OSS_CONSOLE_GROUPS, type ConsoleNavGroup } from '../nav/console-groups';

export interface DashboardShellProps {
  brand: string;
  logoSrc?: string;
  leftSlot?: ReactNode;
  groups?: ConsoleNavGroup[];
  counts?: ConsoleNavCounts;
  roleNote?: ReactNode;
  withConfirmDialog?: boolean;
  children: ReactNode;
}

export function DashboardShell({
  brand,
  logoSrc,
  leftSlot,
  groups = OSS_CONSOLE_GROUPS,
  counts,
  roleNote,
  withConfirmDialog = false,
  children,
}: DashboardShellProps) {
  return (
    <ConsoleShell
      brand={brand}
      logoSrc={logoSrc}
      groups={groups}
      orgSlot={leftSlot}
      counts={counts}
      roleNote={roleNote}
      withConfirmDialog={withConfirmDialog}
    >
      {children}
    </ConsoleShell>
  );
}
