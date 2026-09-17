import { describe, expect, it } from 'vitest';
import {
  FIRST_SETTINGS_HREF,
  OSS_SETTINGS_GROUPS,
  settingsGroupsForRole,
} from '../nav/settings-groups';

describe('settings index target', () => {
  it('lands on the first item of the first nav group', () => {
    expect(FIRST_SETTINGS_HREF).toBe(OSS_SETTINGS_GROUPS[0]!.items[0]!.href);
  });

  it('lands on Account', () => {
    expect(FIRST_SETTINGS_HREF).toBe('/dashboard/settings/account');
  });

  it('points at a page an admin can actually open', () => {
    const reachable = settingsGroupsForRole(OSS_SETTINGS_GROUPS, true).flatMap((g) =>
      g.items.map((i) => i.href),
    );
    expect(reachable).toContain(FIRST_SETTINGS_HREF);
  });
});
