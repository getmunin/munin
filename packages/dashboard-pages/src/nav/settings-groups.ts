import { extendNavGroups } from './extend-groups';

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
      { href: '/dashboard/settings/integrations', labelKey: 'integrations' },
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

export function settingsGroupsForRole(
  groups: SettingsSubNavGroup[],
  isAdmin: boolean,
): SettingsSubNavGroup[] {
  return isAdmin ? groups : [];
}

export interface SettingsGroupExtension {
  groupKey: string;
  items: SettingsSubNavItem[];
  insertAfter?: string;
  insertBefore?: string;
  position?: 'start' | 'end';
}

export function extendSettingsGroups(
  base: SettingsSubNavGroup[],
  extensions: SettingsGroupExtension[],
): SettingsSubNavGroup[] {
  return extendNavGroups(base, extensions);
}
