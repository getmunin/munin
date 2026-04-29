import { schema } from '@getmunin/db';
import { eq } from 'drizzle-orm';
import { getCurrentContext } from '@getmunin/core';
import { BootstrapRunner, defineStep } from '@getmunin/bootstrap';
import { z } from 'zod';
import type { FieldDef } from './cms.fields.js';

const DefaultLocaleSchema = z.object({
  code: z.string().min(2).max(16).default('en'),
  name: z.string().min(1).max(120).default('English'),
});

const FirstCollectionSchema = z.object({
  /** Pass `false` to skip seeding the starter collection. */
  create: z.boolean().default(true),
  name: z.string().min(1).max(120).default('Pages'),
  slug: z.string().min(1).max(64).default('pages'),
});

const STARTER_COLLECTION_FIELDS: FieldDef[] = [
  { name: 'title', type: 'text', required: true },
  { name: 'slug', type: 'text', required: true },
  { name: 'body', type: 'markdown' },
  { name: 'hero_image', type: 'asset' },
  { name: 'published_at', type: 'datetime' },
];

const defaultLocale = defineStep({
  id: 'default_locale',
  prompt:
    'Pick the default locale for your CMS. Suggestion: { "code": "en", "name": "English" }. The default locale is used when an entry omits one.',
  schema: DefaultLocaleSchema,
  shouldRun: async ({ orgId }) => !(await orgHasAnyLocale(orgId)),
  apply: async (value, { orgId }) => {
    const ctx = getCurrentContext();
    if (!/^[a-z]{2}(-[A-Z]{2})?$/.test(value.code)) return;
    await ctx.db.insert(schema.cmsLocales).values({
      orgId,
      code: value.code,
      name: value.name,
      isDefault: true,
      position: 0,
    });
  },
});

const firstCollection = defineStep({
  id: 'first_collection',
  prompt:
    'Want to seed a starter "Pages" collection (title / slug / body / hero_image / published_at)? Pass `{ "create": true }` to accept the default, `{ "create": false }` to skip, or override `name` / `slug`.',
  schema: FirstCollectionSchema,
  shouldRun: async ({ orgId, answers }) => {
    if (answers.first_collection !== undefined) return false;
    return !(await orgHasAnyCollection(orgId));
  },
  apply: async (value, { orgId }) => {
    if (!value.create) return;
    const ctx = getCurrentContext();
    await ctx.db.insert(schema.cmsCollections).values({
      orgId,
      name: value.name,
      slug: value.slug,
      description: null,
      fields: STARTER_COLLECTION_FIELDS,
      localized: false,
      settings: {},
    });
  },
});

async function orgHasAnyLocale(orgId: string): Promise<boolean> {
  const ctx = getCurrentContext();
  const rows = await ctx.db
    .select({ id: schema.cmsLocales.id })
    .from(schema.cmsLocales)
    .where(eq(schema.cmsLocales.orgId, orgId))
    .limit(1);
  return rows.length > 0;
}

async function orgHasAnyCollection(orgId: string): Promise<boolean> {
  const ctx = getCurrentContext();
  const rows = await ctx.db
    .select({ id: schema.cmsCollections.id })
    .from(schema.cmsCollections)
    .where(eq(schema.cmsCollections.orgId, orgId))
    .limit(1);
  return rows.length > 0;
}

export const cmsBootstrap = new BootstrapRunner('cms', [defaultLocale, firstCollection]);
