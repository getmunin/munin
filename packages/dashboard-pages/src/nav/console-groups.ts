import type { OrgRole } from '../auth/use-active-role';

export type ConsoleNavCountKey = 'attention' | 'queue' | 'learning';

export interface ConsoleNavItem {
  href: string;
  labelKey: string;
  roles?: readonly OrgRole[];
  countKey?: ConsoleNavCountKey;
  noteKey?: string;
}

export interface ConsoleNavGroup {
  groupKey: string;
  items: ConsoleNavItem[];
  roles?: readonly OrgRole[];
}

export const ADMIN_ROLES: readonly OrgRole[] = ['owner', 'admin'];

export const OSS_CONSOLE_GROUPS: ConsoleNavGroup[] = [
  {
    groupKey: 'admin',
    roles: ADMIN_ROLES,
    items: [{ href: '/dashboard', labelKey: 'overview', roles: ADMIN_ROLES, countKey: 'queue' }],
  },
  {
    groupKey: 'oversight',
    items: [
      { href: '/dashboard/conversations', labelKey: 'conversations', countKey: 'attention' },
      {
        href: '/dashboard/automation',
        labelKey: 'automation',
        roles: ADMIN_ROLES,
      },
      {
        href: '/dashboard/learning',
        labelKey: 'learning',
        roles: ADMIN_ROLES,
        countKey: 'learning',
      },
    ],
  },
  {
    groupKey: 'workspace',
    roles: ADMIN_ROLES,
    items: [{ href: '/dashboard/settings', labelKey: 'settings', roles: ADMIN_ROLES }],
  },
];

export interface ConsoleGroupExtension {
  groupKey: string;
  items: ConsoleNavItem[];
  roles?: readonly OrgRole[];
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
      group = { groupKey: ext.groupKey, items: [], roles: ext.roles };
      const workspaceIdx = result.findIndex((g) => g.groupKey === 'workspace');
      if (ext.position === 'end' || workspaceIdx < 0) result.push(group);
      else result.splice(workspaceIdx, 0, group);
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

function allows(roles: readonly OrgRole[] | undefined, role: OrgRole | null): boolean {
  if (!roles) return true;
  if (!role) return false;
  return roles.includes(role);
}

export function visibleConsoleGroups(
  groups: ConsoleNavGroup[],
  role: OrgRole | null,
): ConsoleNavGroup[] {
  return groups
    .filter((group) => allows(group.roles, role))
    .map((group) => ({ ...group, items: group.items.filter((item) => allows(item.roles, role)) }))
    .filter((group) => group.items.length > 0);
}

export function isConsoleItemActive(href: string, pathname: string): boolean {
  if (href === '/dashboard') return pathname === '/dashboard';
  return pathname === href || pathname.startsWith(`${href}/`);
}
