import { describe, expect, it } from 'vitest';
import { OSS_SETTINGS_GROUPS, settingsGroupsForRole } from './settings-groups';

describe('settingsGroupsForRole', () => {
  it('admins keep every group', () => {
    expect(settingsGroupsForRole(OSS_SETTINGS_GROUPS, true)).toEqual(OSS_SETTINGS_GROUPS);
  });

  it('support agents get no settings at all', () => {
    expect(settingsGroupsForRole(OSS_SETTINGS_GROUPS, false)).toEqual([]);
  });
});
