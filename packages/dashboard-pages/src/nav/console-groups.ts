import { extendNavGroups } from './extend-groups';
export type ConsoleBadge = 'waiting' | 'queue' | 'learning';

export interface ConsoleNavItem {
  href: string;
  labelKey: string;
  badge?: ConsoleBadge;
  adminOnly?: boolean;
  trailingArrow?: boolean;
}

export interface ConsoleNavGroup {
  groupKey: string;
  items: ConsoleNavItem[];
}

export const OSS_CONSOLE_GROUPS: ConsoleNavGroup[] = [
  {
    groupKey: 'admin',
    items: [{ href: '/dashboard', labelKey: 'overview', badge: 'waiting', adminOnly: true }],
  },
  {
    groupKey: 'oversight',
    items: [
      { href: '/dashboard/conversations', labelKey: 'conversations', badge: 'queue' },
      { href: '/dashboard/automation', labelKey: 'automation', adminOnly: true },
      { href: '/dashboard/learning', labelKey: 'learning', badge: 'learning', adminOnly: true },
    ],
  },
  {
    groupKey: 'workspace',
    items: [
      { href: '/dashboard/settings', labelKey: 'settings', adminOnly: true, trailingArrow: true },
    ],
  },
];

export function consoleGroupsForRole(
  groups: ConsoleNavGroup[],
  isAdmin: boolean,
): ConsoleNavGroup[] {
  if (isAdmin) return groups;
  return groups
    .map((group) => ({ ...group, items: group.items.filter((item) => !item.adminOnly) }))
    .filter((group) => group.items.length > 0);
}

export function isConsoleItemActive(pathname: string, href: string): boolean {
  if (href === '/dashboard') return pathname === '/dashboard' || pathname === '/dashboard/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export interface ConsoleGroupExtension {
  groupKey: string;
  items: ConsoleNavItem[];
  insertAfter?: string;
  insertBefore?: string;
  position?: 'start' | 'end';
}

export function extendConsoleGroups(
  base: ConsoleNavGroup[],
  extensions: ConsoleGroupExtension[],
): ConsoleNavGroup[] {
  return extendNavGroups(base, extensions);
}
