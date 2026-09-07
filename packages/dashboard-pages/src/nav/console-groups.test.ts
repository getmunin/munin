import { describe, expect, it } from 'vitest';
import {
  consoleGroupsForRole,
  extendConsoleGroups,
  isConsoleItemActive,
  type ConsoleNavGroup,
} from './console-groups';

const GROUPS: ConsoleNavGroup[] = [
  {
    groupKey: 'admin',
    items: [{ href: '/dashboard', labelKey: 'overview', adminOnly: true }],
  },
  {
    groupKey: 'oversight',
    items: [
      { href: '/dashboard/conversations', labelKey: 'conversations' },
      { href: '/dashboard/review', labelKey: 'review', adminOnly: true },
    ],
  },
  {
    groupKey: 'workspace',
    items: [{ href: '/dashboard/settings', labelKey: 'settings', adminOnly: true }],
  },
];

describe('consoleGroupsForRole', () => {
  it('keeps everything for admins', () => {
    expect(consoleGroupsForRole(GROUPS, true)).toEqual(GROUPS);
  });

  it('drops admin-only items and the groups they empty for support agents', () => {
    const filtered = consoleGroupsForRole(GROUPS, false);
    expect(filtered.map((g) => g.groupKey)).toEqual(['oversight']);
    expect(filtered[0]!.items.map((i) => i.labelKey)).toEqual(['conversations']);
  });
});

describe('isConsoleItemActive', () => {
  it('matches the dashboard root exactly so overview does not swallow every route', () => {
    expect(isConsoleItemActive('/dashboard', '/dashboard')).toBe(true);
    expect(isConsoleItemActive('/dashboard/conversations', '/dashboard')).toBe(false);
  });

  it('matches sub-routes by segment prefix', () => {
    expect(isConsoleItemActive('/dashboard/conversations/cnv_1', '/dashboard/conversations')).toBe(
      true,
    );
    expect(isConsoleItemActive('/dashboard/conversations-x', '/dashboard/conversations')).toBe(
      false,
    );
  });
});

describe('extendConsoleGroups', () => {
  it('splices extension items relative to existing ones', () => {
    const extended = extendConsoleGroups(GROUPS, [
      {
        groupKey: 'oversight',
        items: [{ href: '/dashboard/automation', labelKey: 'automation' }],
        insertAfter: 'conversations',
      },
    ]);
    expect(extended[1]!.items.map((i) => i.labelKey)).toEqual([
      'conversations',
      'automation',
      'review',
    ]);
    expect(GROUPS[1]!.items).toHaveLength(2);
  });
});
