import { describe, expect, it } from 'vitest';
import { OSS_SETTINGS_GROUPS, settingsGroupsForRole } from './settings-groups';

describe('settingsGroupsForRole', () => {
  it('admins keep every group', () => {
    expect(settingsGroupsForRole(OSS_SETTINGS_GROUPS, true)).toEqual(OSS_SETTINGS_GROUPS);
  });

  it('support agents keep only Workspace → Account', () => {
    const filtered = settingsGroupsForRole(OSS_SETTINGS_GROUPS, false);
    expect(filtered).toEqual([
      {
        groupKey: 'workspace',
        items: [{ href: '/dashboard/settings/account', labelKey: 'account' }],
      },
    ]);
  });
});
