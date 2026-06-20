export interface SettingsSubNavItem {
  href: string;
  labelKey: string;
}

export interface SettingsSubNavGroup {
  groupKey: string;
  items: SettingsSubNavItem[];
}

export const OSS_SETTINGS_GROUPS: SettingsSubNavGroup[] = [
  {
    groupKey: 'workspace',
    items: [
      { href: '/dashboard/settings/account', labelKey: 'account' },
      { href: '/dashboard/settings/team', labelKey: 'team' },
      { href: '/dashboard/settings/ai', labelKey: 'ai' },
      { href: '/dashboard/settings/channels', labelKey: 'channels' },
      { href: '/dashboard/settings/trackers', labelKey: 'trackers' },
    ],
  },
  {
    groupKey: 'access',
    items: [
      { href: '/dashboard/settings/api-keys', labelKey: 'apiKeys' },
      { href: '/dashboard/settings/agents', labelKey: 'agents' },
      { href: '/dashboard/settings/end-users', labelKey: 'endUsers' },
    ],
  },
  {
    groupKey: 'monitoring',
    items: [
      { href: '/dashboard/settings/usage', labelKey: 'usage' },
      { href: '/dashboard/settings/activity', labelKey: 'activity' },
      { href: '/dashboard/settings/audit-log', labelKey: 'auditLog' },
    ],
  },
];

export interface SettingsGroupExtension {
  groupKey: string;
  items: SettingsSubNavItem[];
  insertAfter?: string;
  insertBefore?: string;
  position?: 'start' | 'end';
}

function matchItem(item: SettingsSubNavItem, key: string): boolean {
  return item.labelKey === key || item.href.split('/').pop() === key;
}

export function extendSettingsGroups(
  base: SettingsSubNavGroup[],
  extensions: SettingsGroupExtension[],
): SettingsSubNavGroup[] {
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
