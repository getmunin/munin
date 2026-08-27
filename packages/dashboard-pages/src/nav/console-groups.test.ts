import { describe, it, expect } from 'vitest';
import {
  ADMIN_ROLES,
  OSS_CONSOLE_GROUPS,
  extendConsoleGroups,
  isConsoleItemActive,
  visibleConsoleGroups,
  type ConsoleNavGroup,
} from './console-groups';

const reports: ConsoleNavGroup = {
  groupKey: 'reports',
  items: [
    { href: '/dashboard/reports', labelKey: 'reports' },
    { href: '/dashboard/reports/spend', labelKey: 'spend', roles: ADMIN_ROLES },
  ],
};

describe('visibleConsoleGroups', () => {
  it('gives an owner every group', () => {
    const visible = visibleConsoleGroups([...OSS_CONSOLE_GROUPS, reports], 'owner');
    expect(visible.map((g) => g.groupKey)).toEqual([
      'admin',
      'oversight',
      'workspace',
      'reports',
    ]);
  });

  it('leaves a member with oversight only, since every other group is admin-gated', () => {
    const visible = visibleConsoleGroups([...OSS_CONSOLE_GROUPS, reports], 'member');
    expect(visible.map((g) => g.groupKey)).toEqual(['oversight', 'reports']);
  });

  it('never offers a member a settings link that would bounce them back', () => {
    const visible = visibleConsoleGroups(OSS_CONSOLE_GROUPS, 'member');
    const hrefs = visible.flatMap((g) => g.items.map((i) => i.href));
    expect(hrefs).not.toContain('/dashboard/settings');
    expect(hrefs).not.toContain('/dashboard');
  });

  it('drops admin-only items but keeps the rest of their group', () => {
    const visible = visibleConsoleGroups([reports], 'member');
    expect(visible[0]!.items.map((i) => i.labelKey)).toEqual(['reports']);
  });

  it('drops a group that would render with no items left', () => {
    const adminOnly: ConsoleNavGroup = {
      groupKey: 'reports',
      items: [{ href: '/dashboard/reports/spend', labelKey: 'spend', roles: ADMIN_ROLES }],
    };
    expect(visibleConsoleGroups([adminOnly], 'member')).toEqual([]);
  });

  it('shows nothing role-gated while the role is still unknown', () => {
    expect(visibleConsoleGroups([reports], null).map((g) => g.groupKey)).toEqual(['reports']);
    expect(visibleConsoleGroups([reports], null)[0]!.items).toHaveLength(1);
  });

  it('does not mutate the group list it was given', () => {
    const groups = [reports];
    visibleConsoleGroups(groups, 'member');
    expect(groups[0]!.items).toHaveLength(2);
  });
});

describe('extendConsoleGroups', () => {
  it('inserts a new group before workspace so settings stays last', () => {
    const result = extendConsoleGroups(OSS_CONSOLE_GROUPS, [
      { groupKey: 'reports', items: reports.items },
    ]);
    expect(result.map((g) => g.groupKey)).toEqual([
      'admin',
      'oversight',
      'reports',
      'workspace',
    ]);
  });

  it('appends into an existing group', () => {
    const result = extendConsoleGroups(OSS_CONSOLE_GROUPS, [
      { groupKey: 'workspace', items: [{ href: '/dashboard/billing', labelKey: 'billing' }] },
    ]);
    const workspace = result.find((g) => g.groupKey === 'workspace')!;
    expect(workspace.items.map((i) => i.labelKey)).toEqual(['settings', 'billing']);
  });

  it('honours insertBefore by href tail', () => {
    const result = extendConsoleGroups(OSS_CONSOLE_GROUPS, [
      {
        groupKey: 'workspace',
        insertBefore: 'settings',
        items: [{ href: '/dashboard/billing', labelKey: 'billing' }],
      },
    ]);
    const workspace = result.find((g) => g.groupKey === 'workspace')!;
    expect(workspace.items.map((i) => i.labelKey)).toEqual(['billing', 'settings']);
  });

  it('leaves the base list untouched', () => {
    extendConsoleGroups(OSS_CONSOLE_GROUPS, [
      { groupKey: 'workspace', items: [{ href: '/dashboard/billing', labelKey: 'billing' }] },
    ]);
    const workspace = OSS_CONSOLE_GROUPS.find((g) => g.groupKey === 'workspace')!;
    expect(workspace.items).toHaveLength(1);
  });
});

describe('isConsoleItemActive', () => {
  it('matches the overview only on an exact path so it never wins over a sibling', () => {
    expect(isConsoleItemActive('/dashboard', '/dashboard')).toBe(true);
    expect(isConsoleItemActive('/dashboard', '/dashboard/settings/team')).toBe(false);
  });

  it('matches a section on its own path and its children', () => {
    expect(isConsoleItemActive('/dashboard/settings', '/dashboard/settings')).toBe(true);
    expect(isConsoleItemActive('/dashboard/settings', '/dashboard/settings/team')).toBe(true);
  });

  it('does not match a sibling that merely shares a prefix', () => {
    expect(isConsoleItemActive('/dashboard/learn', '/dashboard/learning')).toBe(false);
  });
});
