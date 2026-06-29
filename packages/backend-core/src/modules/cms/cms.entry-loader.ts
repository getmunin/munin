import { schema, type Db, type Tx } from '@getmunin/db';
import { and, eq, inArray } from 'drizzle-orm';
import { projectData, type ExpandedEntry, type FieldDef } from './cms.fields.ts';

export async function loadEntryMap(
  db: Db | Tx,
  orgId: string,
  ids: Iterable<string>,
  opts: { publishedOnly: boolean },
): Promise<Map<string, ExpandedEntry>> {
  const list = [...new Set(ids)];
  if (list.length === 0) return new Map();
  const filters = [eq(schema.cmsEntries.orgId, orgId), inArray(schema.cmsEntries.id, list)];
  if (opts.publishedOnly) filters.push(eq(schema.cmsEntries.status, 'published'));
  const rows = await db
    .select({
      id: schema.cmsEntries.id,
      slug: schema.cmsEntries.slug,
      locale: schema.cmsEntries.locale,
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
  const map = new Map<string, ExpandedEntry>();
  for (const r of rows) {
    map.set(r.id, {
      id: r.id,
      slug: r.slug,
      collection: r.collectionSlug,
      locale: r.locale,
      data: projectData(r.fields as FieldDef[], r.data),
    });
  }
  return map;
}
