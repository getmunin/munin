import { defaultUrlTransform } from 'react-markdown';
import type { CmsRefExpanded } from './types';

export const REF_SCHEME = 'ref://';

const REF_URI = /ref:\/\/([A-Za-z0-9_]+)/g;
const TITLE_FIELD_CANDIDATES = ['title', 'name', 'headline', 'subject'];

export interface RefDescription {
  id: string;
  label: string;
  collection: string | null;
  locale: string | null;
  resolved: boolean;
  localeFallback: boolean;
}

export function refUrlTransform(url: string): string {
  return url.startsWith(REF_SCHEME) ? url : defaultUrlTransform(url);
}

export function refIdFromHref(href: string | undefined): string | null {
  if (!href || !href.startsWith(REF_SCHEME)) return null;
  const id = href.slice(REF_SCHEME.length);
  return /^[A-Za-z0-9_]+$/.test(id) ? id : null;
}

export function describeRef(
  id: string,
  refs: Record<string, CmsRefExpanded> | undefined,
  entryLocale: string | undefined,
): RefDescription {
  const ref = refs?.[id];
  if (!ref) {
    return {
      id,
      label: id,
      collection: null,
      locale: null,
      resolved: false,
      localeFallback: false,
    };
  }
  return {
    id,
    label: refTitle(ref),
    collection: ref.collection,
    locale: ref.locale,
    resolved: true,
    localeFallback: entryLocale !== undefined && ref.locale !== entryLocale,
  };
}

function refTitle(ref: CmsRefExpanded): string {
  for (const name of TITLE_FIELD_CANDIDATES) {
    const value = ref.data?.[name];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return ref.slug;
}

interface MdNode {
  type: string;
  value?: string;
  url?: string;
  children?: MdNode[];
}

export function remarkRefTokens() {
  return (tree: MdNode): void => {
    linkifyChildren(tree);
  };
}

function linkifyChildren(node: MdNode): void {
  const children = node.children;
  if (!children) return;
  if (node.type === 'link' || node.type === 'linkReference') {
    for (const child of children) linkifyChildren(child);
    return;
  }
  const next: MdNode[] = [];
  let changed = false;
  for (const child of children) {
    if (child.type !== 'text' || !child.value) {
      linkifyChildren(child);
      next.push(child);
      continue;
    }
    const split = splitRefText(child.value);
    if (!split) next.push(child);
    else {
      changed = true;
      next.push(...split);
    }
  }
  if (changed) node.children = next;
}

function splitRefText(value: string): MdNode[] | null {
  const out: MdNode[] = [];
  let last = 0;
  for (const match of value.matchAll(REF_URI)) {
    const at = match.index;
    if (at > last) out.push({ type: 'text', value: value.slice(last, at) });
    out.push({
      type: 'link',
      url: match[0],
      children: [{ type: 'text', value: match[0] }],
    });
    last = at + match[0].length;
  }
  if (out.length === 0) return null;
  if (last < value.length) out.push({ type: 'text', value: value.slice(last) });
  return out;
}
