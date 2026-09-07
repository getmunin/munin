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
    items: [{ href: '/dashboard/conversations', labelKey: 'conversations', badge: 'queue' }],
  },
  {
    groupKey: 'workspace',
    items: [{ href: '/dashboard/settings', labelKey: 'settings', trailingArrow: true }],
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

function matchItem(item: ConsoleNavItem, key: string): boolean {
  return item.labelKey === key || item.href.split('/').pop() === key;
}

export function extendConsoleGroups(
  base: ConsoleNavGroup[],
  extensions: ConsoleGroupExtension[],
): ConsoleNavGroup[] {
  const result = base.map((group) => ({ ...group, items: [...group.items] }));

  for (const ext of extensions) {
    let group = result.find((g) => g.groupKey === ext.groupKey);
    if (!group) {
      group = { groupKey: ext.groupKey, items: [] };
      result.push(group);
    }

    if (ext.insertAfter) {
      const idx = group.items.findIndex((item) => matchItem(item, ext.insertAfter!));
      if (idx >= 0) {
        group.items.splice(idx + 1, 0, ...ext.items);
        continue;
      }
    }

    if (ext.insertBefore) {
      const idx = group.items.findIndex((item) => matchItem(item, ext.insertBefore!));
      if (idx >= 0) {
        group.items.splice(idx, 0, ...ext.items);
        continue;
      }
    }

    if (ext.position === 'start') {
      group.items.unshift(...ext.items);
      continue;
    }

    group.items.push(...ext.items);
  }

  return result;
}
