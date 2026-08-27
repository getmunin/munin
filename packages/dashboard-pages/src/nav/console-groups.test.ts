import { describe, it, expect } from 'vitest';
import {
  ADMIN_ROLES,
  OSS_CONSOLE_GROUPS,
  extendConsoleGroups,
  isConsoleItemActive,
  visibleConsoleGroups,
  type ConsoleNavGroup,
} from './console-groups';

const oversight: ConsoleNavGroup = {
  groupKey: 'oversight',
  items: [
    { href: '/dashboard/conversations', labelKey: 'conversations' },
    { href: '/dashboard/learning', labelKey: 'learning', roles: ADMIN_ROLES },
  ],
};

describe('visibleConsoleGroups', () => {
  it('gives an owner every group', () => {
    const visible = visibleConsoleGroups([...OSS_CONSOLE_GROUPS, oversight], 'owner');
    expect(visible.map((g) => g.groupKey)).toEqual(['admin', 'workspace', 'oversight']);
  });

  it('drops the admin group entirely for a member rather than disabling it', () => {
    const visible = visibleConsoleGroups([...OSS_CONSOLE_GROUPS, oversight], 'member');
    expect(visible.map((g) => g.groupKey)).toEqual(['workspace', 'oversight']);
  });

  it('drops admin-only items but keeps the rest of their group', () => {
    const visible = visibleConsoleGroups([oversight], 'member');
    expect(visible[0]!.items.map((i) => i.labelKey)).toEqual(['conversations']);
  });

  it('drops a group that would render with no items left', () => {
    const adminOnly: ConsoleNavGroup = {
      groupKey: 'oversight',
      items: [{ href: '/dashboard/automation', labelKey: 'automation', roles: ADMIN_ROLES }],
    };
    expect(visibleConsoleGroups([adminOnly], 'member')).toEqual([]);
  });

  it('shows nothing role-gated while the role is still unknown', () => {
    expect(visibleConsoleGroups([oversight], null).map((g) => g.groupKey)).toEqual(['oversight']);
    expect(visibleConsoleGroups([oversight], null)[0]!.items).toHaveLength(1);
  });

  it('does not mutate the group list it was given', () => {
    const groups = [oversight];
    visibleConsoleGroups(groups, 'member');
    expect(groups[0]!.items).toHaveLength(2);
  });
});

describe('extendConsoleGroups', () => {
  it('inserts a new group before workspace so settings stays last', () => {
    const result = extendConsoleGroups(OSS_CONSOLE_GROUPS, [
      { groupKey: 'oversight', items: oversight.items },
    ]);
    expect(result.map((g) => g.groupKey)).toEqual(['admin', 'oversight', 'workspace']);
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
