export interface NavGroupExtension<TItem> {
  groupKey: string;
  items: TItem[];
  insertAfter?: string;
  insertBefore?: string;
  position?: 'start' | 'end';
}

function matchItem(item: { href: string; labelKey: string }, key: string): boolean {
  return item.labelKey === key || item.href.split('/').pop() === key;
}

export function extendNavGroups<TItem extends { href: string; labelKey: string }>(
  base: { groupKey: string; items: TItem[] }[],
  extensions: NavGroupExtension<TItem>[],
): { groupKey: string; items: TItem[] }[] {
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
