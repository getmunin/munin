export type SettingsGroupKey = 'workspace' | 'access' | 'monitoring';

export type SettingsItemKey =
  | 'team'
  | 'channels'
  | 'builtInAi'
  | 'apiKeys'
  | 'agents'
  | 'endUsers'
  | 'usage'
  | 'activity'
  | 'auditLog'
  | 'dataExport';

export interface SettingsSubNavItem {
  href: string;
  labelKey: SettingsItemKey;
}

export interface SettingsSubNavGroup {
  groupKey: SettingsGroupKey;
  items: SettingsSubNavItem[];
}

export const SETTINGS_GROUPS: SettingsSubNavGroup[] = [
  {
    groupKey: 'workspace',
    items: [
      { href: '/dashboard/settings/team', labelKey: 'team' },
      { href: '/dashboard/settings/channels', labelKey: 'channels' },
      { href: '/dashboard/settings/builtin-ai', labelKey: 'builtInAi' },
      { href: '/dashboard/settings/export', labelKey: 'dataExport' },
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
