import { schema, type Db, type Tx } from '@getmunin/db';
import { and, eq, inArray } from 'drizzle-orm';
import {
  projectData,
  type EntryLookup,
  type ExpandedEntry,
  type FieldDef,
} from './cms.fields.ts';

const EMPTY_LOOKUP: EntryLookup = { get: () => undefined, inLocale: () => undefined };

function localeKey(translationGroupId: string, locale: string): string {
  return `${translationGroupId} ${locale}`;
}

export async function loadEntryMap(
  db: Db | Tx,
  orgId: string,
  ids: Iterable<string>,
  opts: { publishedOnly: boolean },
): Promise<EntryLookup> {
  const list = [...new Set(ids)];
  if (list.length === 0) return EMPTY_LOOKUP;
  const groups = db
    .select({ translationGroupId: schema.cmsEntries.translationGroupId })
    .from(schema.cmsEntries)
    .where(and(eq(schema.cmsEntries.orgId, orgId), inArray(schema.cmsEntries.id, list)));
  const filters = [
    eq(schema.cmsEntries.orgId, orgId),
    inArray(schema.cmsEntries.translationGroupId, groups),
  ];
  if (opts.publishedOnly) filters.push(eq(schema.cmsEntries.status, 'published'));
  const rows = await db
    .select({
      id: schema.cmsEntries.id,
      slug: schema.cmsEntries.slug,
      locale: schema.cmsEntries.locale,
      translationGroupId: schema.cmsEntries.translationGroupId,
      data: schema.cmsEntries.data,
      fields: schema.cmsCollections.fields,
      collectionSlug: schema.cmsCollections.slug,
    })
    .from(schema.cmsEntries)
    .innerJoin(
      schema.cmsCollections,
      eq(schema.cmsCollections.id, schema.cmsEntries.collectionId),
    )
    .where(and(...filters));
  const byId = new Map<string, ExpandedEntry>();
  const byGroupLocale = new Map<string, ExpandedEntry>();
  const groupOf = new Map<string, string>();
  for (const r of rows) {
    const entry: ExpandedEntry = {
      id: r.id,
      slug: r.slug,
      collection: r.collectionSlug,
      locale: r.locale,
      data: projectData(r.fields as FieldDef[], r.data),
    };
    byId.set(r.id, entry);
    groupOf.set(r.id, r.translationGroupId);
    byGroupLocale.set(localeKey(r.translationGroupId, r.locale), entry);
  }
  return {
    get: (id) => byId.get(id),
    inLocale: (id, locale) => {
      const group = groupOf.get(id);
      return group ? byGroupLocale.get(localeKey(group, locale)) : undefined;
    },
  };
}
