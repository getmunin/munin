import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { McpTool } from '@getmunin/mcp-toolkit';
import { CmsService, ENTRY_STATUSES } from './cms.service.ts';
import { CmsSearchService } from './cms.search.ts';
import { FIELD_TYPES, type FieldDef } from './cms.fields.ts';
import { IdMapSchema } from '../../common/transfer/transfer.types.ts';

const FieldSchema: z.ZodType<FieldDef> = z.lazy(() =>
  z.object({
    name: z.string().min(1).max(64),
    type: z.enum(FIELD_TYPES),
    required: z.boolean().optional(),
    localized: z.boolean().optional(),
    description: z.string().max(500).optional(),
    default: z.unknown().optional(),
    options: z
      .object({
        choices: z.array(z.string()).optional(),
        targetCollection: z.string().optional(),
        items: z.lazy(() => FieldSchema).optional(),
      })
      .optional(),
  }),
);

const CreateCollectionInput = z.object({
  name: z.string().min(1).max(120),
  slug: z.string().min(1).max(64),
  description: z.string().max(500).optional(),
  fields: z.array(FieldSchema).max(100),
  localized: z.boolean().optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
});

const UpdateCollectionInput = z.object({
  idOrSlug: z.string(),
  patch: z.object({
    name: z.string().min(1).max(120).optional(),
    description: z.string().nullable().optional(),
    fields: z.array(FieldSchema).max(100).optional(),
    settings: z.record(z.string(), z.unknown()).optional(),
  }),
});

const GetCollectionInput = z.object({ idOrSlug: z.string() });
const DeleteCollectionInput = z.object({ idOrSlug: z.string() });

const ListEntriesInput = z.object({
  collection: z.string().optional(),
  status: z.enum(ENTRY_STATUSES).optional(),
  locale: z.string().optional(),
  limit: z.number().int().positive().max(200).optional(),
});

const GetEntryInput = z.object({ id: z.string() });

const CreateEntryInput = z.object({
  collection: z.string(),
  slug: z.string().min(1).max(200),
  locale: z.string().optional(),
  data: z.record(z.string(), z.unknown()),
  status: z.enum(['draft', 'published']).optional(),
});

const UpdateEntryInput = z.object({
  id: z.string(),
  ifVersion: z.number().int().nonnegative(),
  slug: z.string().min(1).max(200).optional(),
  locale: z.string().optional(),
  data: z.record(z.string(), z.unknown()).optional(),
});

const PublishInput = z.object({
  id: z.string(),
  ifVersion: z.number().int().nonnegative(),
});

const ScheduleInput = z.object({
  id: z.string(),
  ifVersion: z.number().int().nonnegative(),
  scheduledAt: z.string().datetime(),
});

const DeleteEntryInput = z.object({
  id: z.string(),
  ifVersion: z.number().int().nonnegative(),
});

const ListVersionsInput = z.object({ entryId: z.string() });

const RestoreVersionInput = z.object({
  entryId: z.string(),
  version: z.number().int().positive(),
  ifVersion: z.number().int().nonnegative(),
});

const ListAssetsInput = z.object({
  limit: z.number().int().positive().max(200).optional(),
});

const RequestUploadInput = z.object({
  name: z.string().min(1).max(255),
  mime: z.string().min(1).max(120),
  sizeBytes: z.number().int().positive(),
  altText: z.string().max(500).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const CompleteUploadInput = z.object({ id: z.string() });
const DeleteAssetInput = z.object({ id: z.string() });

const UploadAssetFromBase64Input = z.object({
  name: z.string().min(1).max(255),
  mime: z.string().min(1).max(120),
  base64Body: z.string().min(1),
  altText: z.string().max(500).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const UploadAssetFromUrlInput = z.object({
  sourceUrl: z
    .string()
    .url()
    .refine((u) => {
      try {
        return new URL(u).protocol === 'https:';
      } catch {
        return false;
      }
    }, 'sourceUrl must use https://'),
  name: z.string().min(1).max(255).optional(),
  mime: z.string().min(1).max(120).optional(),
  altText: z.string().max(500).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const CreateLocaleInput = z.object({
  code: z.string().min(2).max(16),
  name: z.string().min(1).max(120),
  isDefault: z.boolean().optional(),
});

const SetDefaultLocaleInput = z.object({ code: z.string() });

const ListInboundReferencesInput = z.object({ entryId: z.string() });
const ListAssetUsageInput = z.object({ assetId: z.string() });

const SearchInput = z.object({
  query: z.string().min(1).max(500),
  collection: z.string().optional(),
  status: z.enum(ENTRY_STATUSES).optional(),
  locale: z.string().optional(),
  limit: z.number().int().positive().max(50).optional(),
});

const EmptyInput = z.object({});

const CmsImportInput = z.object({
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
        fields: z.array(FieldSchema).max(100),
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
        status: z.enum(ENTRY_STATUSES),
        data: z.record(z.string(), z.unknown()),
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
        base64Body: z.string().nullable().optional(),
      }),
    ),
  }),
  idMap: IdMapSchema.optional(),
});

@Injectable()
export class CmsAdminTools {
  constructor(
    @Inject(CmsService) private readonly cms: CmsService,
    @Inject(CmsSearchService) private readonly search: CmsSearchService,
  ) {}

  // Collections ─────────────────────────────────────────────────────────

  @McpTool({
    name: 'cms_list_collections',
    title: 'CMS: List collections',
    description:
      'List CMS collections (content types) defined for your org. Scaffolding a frontend from Lovable/Bolt/v0/Replit/Cursor and need to render CMS content? Read `skill://playbooks/frontend-integration` — the delivery API is anonymous and intentionally has no CORS, so the fetch must run server-side.',
    audiences: ['admin'],
    scopes: ['cms:read'],
    input: EmptyInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  listCollections() {
    return this.cms.listCollections();
  }

  @McpTool({
    name: 'cms_get_collection',
    title: 'CMS: Read collection',
    description: 'Read one collection by id or slug, including its field definitions.',
    audiences: ['admin'],
    scopes: ['cms:read'],
    input: GetCollectionInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  getCollection(args: z.infer<typeof GetCollectionInput>) {
    return this.cms.getCollection(args.idOrSlug);
  }

  @McpTool({
    name: 'cms_create_collection',
    title: 'CMS: Create collection',
    description:
      'Define a new collection. Fields is an ORDERED array of { name, type, required?, options? } — field order is the render order in editor and public surfaces, so put fields in the sequence a human would read or fill them (e.g. lede asset → headline → excerpt → metadata → body → trailing/optional fields). See field types: text, rich_text, markdown, number, integer, boolean, date, datetime, select, multi_select, asset, reference, array, json.',
    audiences: ['admin'],
    scopes: ['cms:write'],
    input: CreateCollectionInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  createCollection(args: z.infer<typeof CreateCollectionInput>) {
    return this.cms.createCollection(args);
  }

  @McpTool({
    name: 'cms_update_collection',
    title: 'CMS: Update collection',
    description:
      'Patch a collection. When supplied, `fields` REPLACES the existing array — so include every field you want to keep, in the order they should render (the array order is the render order). Field migration is lossy: dropped or renamed fields stay in entries\' `data` jsonb but stop being read by the projection layer.',
    audiences: ['admin'],
    scopes: ['cms:write'],
    input: UpdateCollectionInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  updateCollection(args: z.infer<typeof UpdateCollectionInput>) {
    return this.cms.updateCollection(args.idOrSlug, args.patch);
  }

  @McpTool({
    name: 'cms_delete_collection',
    title: 'CMS: Delete collection',
    description: 'Delete a collection. Cascades to all entries, versions, and references.',
    audiences: ['admin'],
    scopes: ['cms:write'],
    input: DeleteCollectionInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  deleteCollection(args: z.infer<typeof DeleteCollectionInput>) {
    return this.cms.deleteCollection(args.idOrSlug);
  }

  // Entries ─────────────────────────────────────────────────────────────

  @McpTool({
    name: 'cms_list_entries',
    title: 'CMS: List entries',
    description:
      'List entries. Filters: collection (id or slug), status, locale. Drafts and scheduled entries are returned to admins; the public delivery API only ever returns published.',
    audiences: ['admin'],
    scopes: ['cms:read'],
    input: ListEntriesInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  listEntries(args: z.infer<typeof ListEntriesInput>) {
    return this.cms.listEntries(args);
  }

  @McpTool({
    name: 'cms_get_entry',
    title: 'CMS: Read entry',
    description: 'Read one entry. Data is projected through the collection\'s current field schema.',
    audiences: ['admin'],
    scopes: ['cms:read'],
    input: GetEntryInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  getEntry(args: z.infer<typeof GetEntryInput>) {
    return this.cms.getEntry(args.id);
  }

  @McpTool({
    name: 'cms_create_entry',
    title: 'CMS: Create entry',
    description:
      'Create a new entry in a collection. `data` is keyed by field name; required fields must be present. Pass `status: "published"` to publish on creation; default is draft.',
    audiences: ['admin'],
    scopes: ['cms:write'],
    input: CreateEntryInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  createEntry(args: z.infer<typeof CreateEntryInput>) {
    return this.cms.createEntry(args);
  }

  @McpTool({
    name: 'cms_update_entry',
    title: 'CMS: Update entry',
    description:
      'Update an entry. Pass `ifVersion` (the current version you read) for optimistic concurrency. `data` is a partial patch — keys you send replace the corresponding keys on the existing entry; keys you omit are preserved. Pass an explicit `null` to clear a single key. The merged payload is then re-validated against the collection schema, and search_text + embedding + references are regenerated.',
    audiences: ['admin'],
    scopes: ['cms:write'],
    input: UpdateEntryInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  updateEntry(args: z.infer<typeof UpdateEntryInput>) {
    return this.cms.updateEntry(args);
  }

  @McpTool({
    name: 'cms_publish_entry',
    title: 'CMS: Publish entry',
    description: 'Flip an entry to status="published". Stamps publishedAt and fires cms.entry.published.',
    audiences: ['admin'],
    scopes: ['cms:write'],
    input: PublishInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  publishEntry(args: z.infer<typeof PublishInput>) {
    return this.cms.publishEntry(args);
  }

  @McpTool({
    name: 'cms_unpublish_entry',
    title: 'CMS: Unpublish entry',
    description: 'Revert an entry to status="draft". Clears publishedAt; fires cms.entry.unpublished.',
    audiences: ['admin'],
    scopes: ['cms:write'],
    input: PublishInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  unpublishEntry(args: z.infer<typeof PublishInput>) {
    return this.cms.unpublishEntry(args);
  }

  @McpTool({
    name: 'cms_schedule_publish',
    title: 'CMS: Schedule entry publish',
    description:
      'Schedule an entry to flip to published at a future ISO 8601 datetime. The schedule worker drains due rows every minute.',
    audiences: ['admin'],
    scopes: ['cms:write'],
    input: ScheduleInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  scheduleEntry(args: z.infer<typeof ScheduleInput>) {
    return this.cms.scheduleEntry(args);
  }

  @McpTool({
    name: 'cms_delete_entry',
    title: 'CMS: Delete entry',
    description: 'Delete an entry. Cascades to its versions and references.',
    audiences: ['admin'],
    scopes: ['cms:write'],
    input: DeleteEntryInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  deleteEntry(args: z.infer<typeof DeleteEntryInput>) {
    return this.cms.deleteEntry(args);
  }

  @McpTool({
    name: 'cms_list_versions',
    title: 'CMS: List entry versions',
    description: 'List all prior versions of an entry, newest first.',
    audiences: ['admin'],
    scopes: ['cms:read'],
    input: ListVersionsInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  listVersions(args: z.infer<typeof ListVersionsInput>) {
    return this.cms.listVersions(args.entryId);
  }

  @McpTool({
    name: 'cms_restore_version',
    title: 'CMS: Restore entry version',
    description:
      'Roll an entry back to an earlier version. Creates a new current version with that historical data.',
    audiences: ['admin'],
    scopes: ['cms:write'],
    input: RestoreVersionInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  restoreVersion(args: z.infer<typeof RestoreVersionInput>) {
    return this.cms.restoreVersion(args);
  }

  // Assets ──────────────────────────────────────────────────────────────

  @McpTool({
    name: 'cms_list_assets',
    title: 'CMS: List assets',
    description: 'List media-library assets in your org.',
    audiences: ['admin'],
    scopes: ['cms:read'],
    input: ListAssetsInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  listAssets(args: z.infer<typeof ListAssetsInput>) {
    return this.cms.listAssets(args);
  }

  @McpTool({
    name: 'cms_request_asset_upload',
    title: 'CMS: Request asset upload URL',
    description:
      'Mint a presigned upload for a new asset. Only usable from clients that can issue raw HTTP PUT/POST themselves. If your runtime has no client-side PUT primitive, this tool is not a fit — use `cms_upload_asset_from_base64` (small inline base64) or `cms_upload_asset_from_url` (public HTTPS URL) instead. Flow: the asset row is created in `uploaded:false` state. Look at `uploadMethod`: if `"PUT"`, send the file body as the raw PUT body to `uploadUrl`. If `"POST"`, send multipart/form-data to `uploadUrl` including every key/value in `uploadFields` followed by a `file` part; the embedded policy enforces an exact `Content-Length` match. Then call `cms_complete_asset_upload` to verify and mark the row live. SVG uploads are rejected — SVG can carry inline scripts and is not safe to serve as an asset.',
    audiences: ['admin'],
    scopes: ['cms:write'],
    input: RequestUploadInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  requestUpload(args: z.infer<typeof RequestUploadInput>) {
    return this.cms.requestAssetUpload(args);
  }

  @McpTool({
    name: 'cms_upload_asset_from_base64',
    title: 'CMS: Upload asset from base64',
    description:
      'Upload a small asset inline as base64 (≤100 KB decoded). The right choice when you have generated the asset in this conversation (image-gen output, screenshot, plot) and need it in the CMS without leaving the chat: compress to WebP or JPEG well under 100 KB first, then pass the bytes here. SVG is rejected. For larger assets reachable over HTTPS use `cms_upload_asset_from_url`; for larger arbitrary files use `cms_request_asset_upload` from a client that can issue HTTP PUT.',
    audiences: ['admin'],
    scopes: ['cms:write'],
    input: UploadAssetFromBase64Input,
    readOnlyHint: false,
    destructiveHint: true,
  })
  uploadAssetFromBase64(args: z.infer<typeof UploadAssetFromBase64Input>) {
    return this.cms.uploadAssetFromBase64(args);
  }

  @McpTool({
    name: 'cms_upload_asset_from_url',
    title: 'CMS: Upload asset from URL',
    description:
      'Fetch a publicly reachable HTTPS asset and store it as a CMS asset in one call. Use this when your runtime cannot PUT to a presigned URL or pass large base64 payloads — typical for ChatGPT/Claude workspace agents whose sandbox blocks outbound PUTs and truncates long base64 strings. The server fetches the URL with SSRF protection, validates content-type (image/*, video/*, audio/*, application/pdf — SVG rejected) and size (≤50 MB), and creates the asset row in `uploaded:true` state. Filename and MIME are inferred from the response unless overridden. The original URL is recorded in `metadata.sourceUrl`.',
    audiences: ['admin'],
    scopes: ['cms:write'],
    input: UploadAssetFromUrlInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  uploadAssetFromUrl(args: z.infer<typeof UploadAssetFromUrlInput>) {
    return this.cms.uploadAssetFromUrl(args);
  }

  @McpTool({
    name: 'cms_complete_asset_upload',
    title: 'CMS: Complete asset upload',
    description: 'Mark a previously-requested asset upload as complete.',
    audiences: ['admin'],
    scopes: ['cms:write'],
    input: CompleteUploadInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  completeUpload(args: z.infer<typeof CompleteUploadInput>) {
    return this.cms.completeAssetUpload(args);
  }

  @McpTool({
    name: 'cms_delete_asset',
    title: 'CMS: Delete asset',
    description:
      'Delete an asset and remove the underlying file from storage. Fails with a conflict if the asset is still referenced by any entry, as a typed asset field or inline in a body.',
    audiences: ['admin'],
    scopes: ['cms:write'],
    input: DeleteAssetInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  deleteAsset(args: z.infer<typeof DeleteAssetInput>) {
    return this.cms.deleteAsset(args);
  }

  // Locales ─────────────────────────────────────────────────────────────

  @McpTool({
    name: 'cms_list_locales',
    title: 'CMS: List locales',
    description: 'List configured locales for your org. The default locale is used when an entry omits one.',
    audiences: ['admin'],
    scopes: ['cms:read'],
    input: EmptyInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  listLocales() {
    return this.cms.listLocales();
  }

  @McpTool({
    name: 'cms_create_locale',
    title: 'CMS: Create locale',
    description: 'Add a locale. Code is ISO 639-1 (e.g. "en") or BCP-47 ("en-US"). The first locale is the default unless overridden.',
    audiences: ['admin'],
    scopes: ['cms:write'],
    input: CreateLocaleInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  createLocale(args: z.infer<typeof CreateLocaleInput>) {
    return this.cms.createLocale(args);
  }

  @McpTool({
    name: 'cms_set_default_locale',
    title: 'CMS: Set default locale',
    description: 'Set which locale is treated as the org\'s default for new entries.',
    audiences: ['admin'],
    scopes: ['cms:write'],
    input: SetDefaultLocaleInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  setDefaultLocale(args: z.infer<typeof SetDefaultLocaleInput>) {
    return this.cms.setDefaultLocale(args);
  }

  // References ──────────────────────────────────────────────────────────

  @McpTool({
    name: 'cms_list_inbound_references',
    title: 'CMS: List inbound references',
    description:
      'List entries that link to the given entry. Useful before deleting — see "what would break".',
    audiences: ['admin'],
    scopes: ['cms:read'],
    input: ListInboundReferencesInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  listInboundReferences(args: z.infer<typeof ListInboundReferencesInput>) {
    return this.cms.listInboundReferences(args.entryId);
  }

  @McpTool({
    name: 'cms_list_asset_usage',
    title: 'CMS: List asset usage',
    description:
      'List entries that use the given asset, either as a typed asset field or as an inline reference inside a markdown/rich_text body. Useful before deleting an asset — an asset that is still in use cannot be deleted.',
    audiences: ['admin'],
    scopes: ['cms:read'],
    input: ListAssetUsageInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  listAssetUsage(args: z.infer<typeof ListAssetUsageInput>) {
    return this.cms.listAssetUsage(args.assetId);
  }

  // Search ──────────────────────────────────────────────────────────────

  @McpTool({
    name: 'cms_search',
    title: 'CMS: Search entries',
    description:
      'Hybrid full-text + semantic search across CMS entries. Returns drafts and published; the public delivery API runs the same engine but hard-filters to published-only.',
    audiences: ['admin'],
    scopes: ['cms:read'],
    input: SearchInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  searchEntries(args: z.infer<typeof SearchInput>) {
    return this.search.search(args);
  }

  // Transfer ────────────────────────────────────────────────────────────

  @McpTool({
    name: 'cms_export',
    title: 'CMS: Export data',
    description:
      "Export this org's CMS (locales, collections, entries, and assets) as a portable JSON payload. Pair with `cms_import` on another Munin server to move content between self-hosted and cloud. Asset bytes are included base64-encoded (assets larger than 5MB are exported as metadata only). Entry embeddings are not included — they are regenerated on import. Feed the returned `records` straight into `cms_import`.",
    audiences: ['admin'],
    scopes: ['cms:read'],
    input: EmptyInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  exportCms() {
    return this.cms.exportCms();
  }

  @McpTool({
    name: 'cms_import',
    title: 'CMS: Import data',
    description:
      'Import CMS `records` produced by `cms_export` (typically from another Munin server). Locales are upserted by code, collections by slug, entries by (collection, slug, locale), and assets by (name, size) — so re-running is idempotent. Asset bytes are re-uploaded to this server and entry references/asset ids are rewritten to local ids. Entry embeddings are regenerated here. Returns counts and an `idMap` (source id → id on this server); pass that `idMap` back into later imports so dependent records resolve their parents.',
    audiences: ['admin'],
    scopes: ['cms:write'],
    input: CmsImportInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  importCms(args: z.infer<typeof CmsImportInput>) {
    const records = {
      locales: args.records.locales,
      collections: args.records.collections.map((c) => ({
        ...c,
        description: c.description ?? null,
      })),
      entries: args.records.entries.map((e) => ({
        ...e,
        scheduledAt: e.scheduledAt ?? null,
      })),
      assets: args.records.assets.map((a) => ({
        ...a,
        altText: a.altText ?? null,
        base64Body: a.base64Body ?? null,
      })),
    };
    return this.cms.importCms(records, args.idMap);
  }
}
