import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { McpTool } from '@getmunin/mcp-toolkit';
import { CmsService, ENTRY_STATUSES } from './cms.service.js';
import { CmsSearchService } from './cms.search.js';
import { FIELD_TYPES, type FieldDef } from './cms.fields.js';

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

const CreateLocaleInput = z.object({
  code: z.string().min(2).max(16),
  name: z.string().min(1).max(120),
  isDefault: z.boolean().optional(),
});

const SetDefaultLocaleInput = z.object({ code: z.string() });

const ListInboundReferencesInput = z.object({ entryId: z.string() });

const SearchInput = z.object({
  query: z.string().min(1).max(500),
  collection: z.string().optional(),
  status: z.enum(ENTRY_STATUSES).optional(),
  locale: z.string().optional(),
  limit: z.number().int().positive().max(50).optional(),
});

const EmptyInput = z.object({});

@Injectable()
export class CmsAdminTools {
  constructor(
    @Inject(CmsService) private readonly cms: CmsService,
    @Inject(CmsSearchService) private readonly search: CmsSearchService,
  ) {}

  // Collections ─────────────────────────────────────────────────────────

  @McpTool({
    name: 'cms_list_collections',
    description: 'List CMS collections (content types) defined for your org.',
    audiences: ['admin'],
    scopes: ['cms:read'],
    input: EmptyInput,
  })
  listCollections() {
    return this.cms.listCollections();
  }

  @McpTool({
    name: 'cms_get_collection',
    description: 'Read one collection by id or slug, including its field definitions.',
    audiences: ['admin'],
    scopes: ['cms:read'],
    input: GetCollectionInput,
  })
  getCollection(args: z.infer<typeof GetCollectionInput>) {
    return this.cms.getCollection(args.idOrSlug);
  }

  @McpTool({
    name: 'cms_create_collection',
    description:
      'Define a new collection. Fields is an array of { name, type, required?, options? } — see field types: text, rich_text, markdown, number, integer, boolean, date, datetime, select, multi_select, asset, reference, array, json.',
    audiences: ['admin'],
    scopes: ['cms:write'],
    input: CreateCollectionInput,
  })
  createCollection(args: z.infer<typeof CreateCollectionInput>) {
    return this.cms.createCollection(args);
  }

  @McpTool({
    name: 'cms_update_collection',
    description:
      'Patch a collection. Field migration is lossy: dropped/renamed fields stay in entries\' data jsonb but stop being read; a future cms_migrate_collection tool can rewrite.',
    audiences: ['admin'],
    scopes: ['cms:write'],
    input: UpdateCollectionInput,
  })
  updateCollection(args: z.infer<typeof UpdateCollectionInput>) {
    return this.cms.updateCollection(args.idOrSlug, args.patch);
  }

  @McpTool({
    name: 'cms_delete_collection',
    description: 'Delete a collection. Cascades to all entries, versions, and references.',
    audiences: ['admin'],
    scopes: ['cms:write'],
    input: DeleteCollectionInput,
  })
  deleteCollection(args: z.infer<typeof DeleteCollectionInput>) {
    return this.cms.deleteCollection(args.idOrSlug);
  }

  // Entries ─────────────────────────────────────────────────────────────

  @McpTool({
    name: 'cms_list_entries',
    description:
      'List entries. Filters: collection (id or slug), status, locale. Drafts and scheduled entries are returned to admins; the public delivery API only ever returns published.',
    audiences: ['admin'],
    scopes: ['cms:read'],
    input: ListEntriesInput,
  })
  listEntries(args: z.infer<typeof ListEntriesInput>) {
    return this.cms.listEntries(args);
  }

  @McpTool({
    name: 'cms_get_entry',
    description: 'Read one entry. Data is projected through the collection\'s current field schema.',
    audiences: ['admin'],
    scopes: ['cms:read'],
    input: GetEntryInput,
  })
  getEntry(args: z.infer<typeof GetEntryInput>) {
    return this.cms.getEntry(args.id);
  }

  @McpTool({
    name: 'cms_create_entry',
    description:
      'Create a new entry in a collection. `data` is keyed by field name; required fields must be present. Pass `status: "published"` to publish on creation; default is draft.',
    audiences: ['admin'],
    scopes: ['cms:write'],
    input: CreateEntryInput,
  })
  createEntry(args: z.infer<typeof CreateEntryInput>) {
    return this.cms.createEntry(args);
  }

  @McpTool({
    name: 'cms_update_entry',
    description:
      'Update an entry. Pass `ifVersion` (the current version you read) for optimistic concurrency. Updating `data` re-validates against the collection schema, regenerates search_text + embedding, and rewrites references.',
    audiences: ['admin'],
    scopes: ['cms:write'],
    input: UpdateEntryInput,
  })
  updateEntry(args: z.infer<typeof UpdateEntryInput>) {
    return this.cms.updateEntry(args);
  }

  @McpTool({
    name: 'cms_publish_entry',
    description: 'Flip an entry to status="published". Stamps publishedAt and fires cms.entry.published.',
    audiences: ['admin'],
    scopes: ['cms:write'],
    input: PublishInput,
  })
  publishEntry(args: z.infer<typeof PublishInput>) {
    return this.cms.publishEntry(args);
  }

  @McpTool({
    name: 'cms_unpublish_entry',
    description: 'Revert an entry to status="draft". Clears publishedAt; fires cms.entry.unpublished.',
    audiences: ['admin'],
    scopes: ['cms:write'],
    input: PublishInput,
  })
  unpublishEntry(args: z.infer<typeof PublishInput>) {
    return this.cms.unpublishEntry(args);
  }

  @McpTool({
    name: 'cms_schedule_publish',
    description:
      'Schedule an entry to flip to published at a future ISO 8601 datetime. The schedule worker drains due rows every minute.',
    audiences: ['admin'],
    scopes: ['cms:write'],
    input: ScheduleInput,
  })
  scheduleEntry(args: z.infer<typeof ScheduleInput>) {
    return this.cms.scheduleEntry(args);
  }

  @McpTool({
    name: 'cms_delete_entry',
    description: 'Delete an entry. Cascades to its versions and references.',
    audiences: ['admin'],
    scopes: ['cms:write'],
    input: DeleteEntryInput,
  })
  deleteEntry(args: z.infer<typeof DeleteEntryInput>) {
    return this.cms.deleteEntry(args);
  }

  @McpTool({
    name: 'cms_list_versions',
    description: 'List all prior versions of an entry, newest first.',
    audiences: ['admin'],
    scopes: ['cms:read'],
    input: ListVersionsInput,
  })
  listVersions(args: z.infer<typeof ListVersionsInput>) {
    return this.cms.listVersions(args.entryId);
  }

  @McpTool({
    name: 'cms_restore_version',
    description:
      'Roll an entry back to an earlier version. Creates a new current version with that historical data.',
    audiences: ['admin'],
    scopes: ['cms:write'],
    input: RestoreVersionInput,
  })
  restoreVersion(args: z.infer<typeof RestoreVersionInput>) {
    return this.cms.restoreVersion(args);
  }

  // Assets ──────────────────────────────────────────────────────────────

  @McpTool({
    name: 'cms_list_assets',
    description: 'List media-library assets in your org.',
    audiences: ['admin'],
    scopes: ['cms:read'],
    input: ListAssetsInput,
  })
  listAssets(args: z.infer<typeof ListAssetsInput>) {
    return this.cms.listAssets(args);
  }

  @McpTool({
    name: 'cms_request_asset_upload',
    description:
      'Mint a presigned upload URL for a new asset. The asset row is created in `uploaded:false` state; PUT the file body to `uploadUrl`, then call cms_complete_asset_upload to mark it live.',
    audiences: ['admin'],
    scopes: ['cms:write'],
    input: RequestUploadInput,
  })
  requestUpload(args: z.infer<typeof RequestUploadInput>) {
    return this.cms.requestAssetUpload(args);
  }

  @McpTool({
    name: 'cms_complete_asset_upload',
    description: 'Mark a previously-requested asset upload as complete.',
    audiences: ['admin'],
    scopes: ['cms:write'],
    input: CompleteUploadInput,
  })
  completeUpload(args: z.infer<typeof CompleteUploadInput>) {
    return this.cms.completeAssetUpload(args);
  }

  @McpTool({
    name: 'cms_delete_asset',
    description: 'Delete an asset and remove the underlying file from storage.',
    audiences: ['admin'],
    scopes: ['cms:write'],
    input: DeleteAssetInput,
  })
  deleteAsset(args: z.infer<typeof DeleteAssetInput>) {
    return this.cms.deleteAsset(args);
  }

  // Locales ─────────────────────────────────────────────────────────────

  @McpTool({
    name: 'cms_list_locales',
    description: 'List configured locales for your org. The default locale is used when an entry omits one.',
    audiences: ['admin'],
    scopes: ['cms:read'],
    input: EmptyInput,
  })
  listLocales() {
    return this.cms.listLocales();
  }

  @McpTool({
    name: 'cms_create_locale',
    description: 'Add a locale. Code is ISO 639-1 (e.g. "en") or BCP-47 ("en-US"). The first locale is the default unless overridden.',
    audiences: ['admin'],
    scopes: ['cms:write'],
    input: CreateLocaleInput,
  })
  createLocale(args: z.infer<typeof CreateLocaleInput>) {
    return this.cms.createLocale(args);
  }

  @McpTool({
    name: 'cms_set_default_locale',
    description: 'Set which locale is treated as the org\'s default for new entries.',
    audiences: ['admin'],
    scopes: ['cms:write'],
    input: SetDefaultLocaleInput,
  })
  setDefaultLocale(args: z.infer<typeof SetDefaultLocaleInput>) {
    return this.cms.setDefaultLocale(args);
  }

  // References ──────────────────────────────────────────────────────────

  @McpTool({
    name: 'cms_list_inbound_references',
    description:
      'List entries that link to the given entry. Useful before deleting — see "what would break".',
    audiences: ['admin'],
    scopes: ['cms:read'],
    input: ListInboundReferencesInput,
  })
  listInboundReferences(args: z.infer<typeof ListInboundReferencesInput>) {
    return this.cms.listInboundReferences(args.entryId);
  }

  // Search ──────────────────────────────────────────────────────────────

  @McpTool({
    name: 'cms_search',
    description:
      'Hybrid full-text + semantic search across CMS entries. Returns drafts and published; the public delivery API runs the same engine but hard-filters to published-only.',
    audiences: ['admin'],
    scopes: ['cms:read'],
    input: SearchInput,
  })
  searchEntries(args: z.infer<typeof SearchInput>) {
    return this.search.search(args);
  }
}
