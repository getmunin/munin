import { z } from 'zod';
import { ENTRY_STATUSES, type CmsExportData } from './cms.service.ts';
import { FIELD_TYPES, type FieldDef } from './cms.fields.ts';
import { IdMapSchema } from '../../common/transfer/transfer.types.ts';

export const FieldSchema: z.ZodType<FieldDef> = z.lazy(() =>
  z.object({
    name: z.string().min(1).max(64),
    type: z.enum(FIELD_TYPES),
    required: z.boolean().optional(),
    localized: z.boolean().optional(),
    inlineRefs: z
      .boolean()
      .optional()
      .describe(
        'Read inline ref:// tokens from this field even though it is not markdown/rich_text. Only valid on text, rich_text, markdown, or an array of those. Without it a ref:// token in a text field is never resolved and is rejected on save.',
      ),
    description: z.string().max(500).optional(),
    default: z.unknown().optional(),
    options: z
      .object({
        choices: z.array(z.string()).optional(),
        targetCollection: z.string().optional(),
        items: z.lazy(() => FieldSchema).optional(),
        blockTypes: z
          .array(
            z.object({
              name: z.string().min(1).max(64),
              label: z.string().max(120).optional(),
              description: z.string().max(500).optional(),
              fields: z.array(z.lazy(() => FieldSchema)).max(100),
            }),
          )
          .optional(),
      })
      .optional(),
  }),
);

export const CmsExportInput = z.object({
  collections: z
    .array(z.string().min(1).max(64))
    .min(1)
    .max(100)
    .optional()
    .describe(
      'Collection slugs to export. Only those collections, their entries, the locales those entries use, and the assets those entries reference are included. Omit to export the whole CMS.',
    ),
  includeAssetBytes: z
    .boolean()
    .optional()
    .describe(
      'Inline each asset\'s bytes as `base64Body` (assets over 5MB stay metadata only). Defaults to false: assets carry a `sourceUrl` that `cms_import` fetches server-side instead. Set it only when the importing server cannot reach this server\'s asset URLs, such as a self-hosted server on a private network.',
    ),
});

function cmsImportInput<F extends z.ZodType>(fieldDef: F) {
  return z.object({
    records: z.object({
      locales: z.array(
        z.object({
          id: z.string(),
          code: z.string().min(2).max(16),
          name: z.string().min(1).max(120),
          isDefault: z.boolean(),
        }),
      ),
      collections: z.array(
        z.object({
          id: z.string(),
          name: z.string().min(1).max(120),
          slug: z.string().min(1).max(64),
          description: z.string().nullable().optional(),
          fields: z.array(fieldDef).max(100),
          localized: z.boolean(),
          settings: z.record(z.string(), z.unknown()),
        }),
      ),
      entries: z.array(
        z.object({
          id: z.string(),
          collectionId: z.string(),
          slug: z.string().min(1).max(200),
          locale: z.string().min(1).max(16),
          translationGroupId: z.string().optional(),
          status: z.enum(ENTRY_STATUSES),
          data: z.record(z.string(), z.unknown()),
          publishedAt: z.string().nullable().optional(),
          scheduledAt: z.string().nullable().optional(),
        }),
      ),
      assets: z.array(
        z.object({
          id: z.string(),
          name: z.string().min(1).max(255),
          mime: z.string().min(1).max(120),
          sizeBytes: z.number().int().nonnegative(),
          storageKey: z.string(),
          altText: z.string().nullable().optional(),
          metadata: z.record(z.string(), z.unknown()),
          sourceUrl: z.string().url().max(2048).nullable().optional(),
          base64Body: z.string().nullable().optional(),
        }),
      ),
    }),
    idMap: IdMapSchema.optional(),
  });
}

export const CmsImportInput = cmsImportInput(FieldSchema);

export const CmsImportBody = cmsImportInput(z.unknown());

export function toCmsExportData(records: z.infer<typeof CmsImportBody>['records']): CmsExportData {
  return {
    locales: records.locales,
    collections: records.collections.map((c) => ({
      ...c,
      description: c.description ?? null,
      fields: c.fields as FieldDef[],
    })),
    entries: records.entries.map((e) => ({
      ...e,
      publishedAt: e.publishedAt ?? null,
      scheduledAt: e.scheduledAt ?? null,
    })),
    assets: records.assets.map((a) => ({
      ...a,
      altText: a.altText ?? null,
      sourceUrl: a.sourceUrl ?? null,
      base64Body: a.base64Body ?? null,
    })),
  };
}
