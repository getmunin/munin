import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { McpTool } from '@getmunin/mcp-toolkit';
import { WEB_SCRAPE_SITE_TASK_URI } from '@getmunin/types';
import { KbService } from './kb.service.ts';
import { KbSearchService } from './kb.search.ts';
import { CuratorJobsService } from '../curator/curator-jobs.service.ts';
import { IdMapSchema } from '../../common/transfer/transfer.types.ts';
import { INSPECTOR_APP_URI } from '../../mcp/inspector.resource.ts';

const TagsSchema = z.array(z.string().min(1).max(64)).max(32);

const CreateSpaceInput = z.object({
  name: z.string().min(1).max(120),
  slug: z.string().min(1).max(64),
  description: z.string().max(1000).optional(),
});

const ListDocumentsInput = z.object({
  spaceId: z.string().optional(),
  tag: z.string().optional(),
  limit: z.number().int().positive().max(200).optional(),
});

const GetDocumentInput = z.object({
  id: z.string(),
});

const GetDocumentBySlugInput = z.object({
  spaceSlug: z.string().min(1).max(64),
  slug: z.string().min(1).max(64),
});

const AudienceSchema = z.enum(['admin', 'self_service']);
const AudiencesSchema = z.array(AudienceSchema).min(1);

const SourceUrlSchema = z
  .string()
  .min(1)
  .max(2048)
  .describe(
    'The public page this document is the knowledge-base copy of, as an absolute http(s) URL. Returned by kb_search and kb_get_document so an answer can link to it.',
  );

const CreateDocumentInput = z.object({
  spaceId: z.string(),
  title: z.string().min(1).max(300),
  body: z.string().min(1),
  sourceUrl: SourceUrlSchema.optional(),
  audiences: AudiencesSchema.optional(),
  tags: TagsSchema.optional(),
  slug: z.string().min(1).max(64).optional(),
});

const UpdateDocumentInput = z.object({
  id: z.string(),
  ifVersion: z.number().int().nonnegative(),
  title: z.string().min(1).max(300).optional(),
  body: z.string().min(1).optional(),
  sourceUrl: SourceUrlSchema.nullable()
    .optional()
    .describe(
      'The public page this document is the knowledge-base copy of, as an absolute http(s) URL. Omit to leave it as it is; pass null to clear it.',
    ),
  audiences: AudiencesSchema.optional(),
  tags: TagsSchema.optional(),
});

const DeleteDocumentInput = z.object({
  id: z.string(),
  ifVersion: z.number().int().nonnegative(),
});

const ListVersionsInput = z.object({
  documentId: z.string(),
});

const RestoreVersionInput = z.object({
  documentId: z.string(),
  version: z.number().int().positive(),
  ifVersion: z.number().int().nonnegative(),
});

const SearchInput = z.object({
  query: z.string().min(1).max(500),
  spaceId: z.string().optional(),
  limit: z.number().int().positive().max(50).optional(),
});

const ProposeCurationCandidateInput = z.object({
  subject: z.string().min(1).max(300),
  draftBody: z.string().min(1),
  sourceConversationId: z.string().min(1).max(64).optional(),
  sourceMessageIds: z.array(z.string().min(1).max(64)).max(32).optional(),
  proposedTargetSpaceSlug: z.string().min(1).max(64).optional(),
});

const ProposeCurationRevisionInput = z.object({
  revisesDocumentId: z.string().min(1),
  draftBody: z.string().min(1).describe('The full proposed body of the revised document.'),
  subject: z
    .string()
    .min(1)
    .max(300)
    .optional()
    .describe("Defaults to the revised document's current title."),
  sourceConversationId: z.string().min(1).max(64).optional(),
  sourceMessageId: z.string().min(1).max(64).optional(),
});

const PublishCurationRevisionInput = z.object({
  candidateDocumentId: z.string().min(1),
  ifCandidateVersion: z
    .number()
    .int()
    .nonnegative()
    .describe(
      'The candidate `version` that was reviewed, binding this publish to that exact proposed text.',
    ),
  ifDocumentVersion: z
    .number()
    .int()
    .nonnegative()
    .describe(
      'The revised document `version` the proposal was diffed against, so a document edited elsewhere since is not silently overwritten.',
    ),
});

const PublishCurationCandidateInput = z.object({
  candidateDocumentId: z.string().min(1),
  targetSpaceSlug: z.string().min(1).max(64),
  ifVersion: z
    .number()
    .int()
    .nonnegative()
    .describe(
      'The candidate document `version` that was reviewed, binding this publish to that exact text.',
    ),
  audiences: AudiencesSchema.optional(),
});

const ListCurationCandidatesInput = z.object({
  limit: z.number().int().positive().max(200).optional(),
});

const DismissCurationCandidateInput = z.object({
  candidateDocumentId: z.string().min(1),
  ifVersion: z
    .number()
    .int()
    .nonnegative()
    .describe(
      'The candidate document `version` that was reviewed, binding this dismissal to that exact text.',
    ),
  reason: z.string().min(1).max(500).optional(),
});

const ListCurationDecisionsInput = z.object({
  outcome: z.enum(['dismissed', 'published']).optional(),
  sourceConversationId: z.string().min(1).max(64).optional(),
  limit: z.number().int().positive().max(200).optional(),
});

const ImportWebsiteInput = z.object({
  url: z.string().min(1).max(2048),
  synthesizeCompanyProfile: z.boolean().optional(),
  reconcile: z.boolean().optional(),
});

const ImportWebsiteStatusInput = z.object({
  jobId: z.string().min(1),
});

const EmptyInput = z.object({});

const KbImportInput = z.object({
  records: z.object({
    spaces: z.array(
      z.object({
        id: z.string(),
        name: z.string().min(1).max(120),
        slug: z.string().min(1).max(64),
        description: z.string().nullable().optional(),
      }),
    ),
    documents: z.array(
      z.object({
        id: z.string(),
        spaceId: z.string(),
        slug: z.string().nullable().optional(),
        title: z.string().min(1).max(300),
        body: z.string().min(1),
        sourceUrl: z.string().min(1).max(2048).nullable().optional(),
        audiences: AudiencesSchema,
        tags: TagsSchema,
      }),
    ),
  }),
  idMap: IdMapSchema.optional(),
});

@Injectable()
export class KbAdminTools {
  constructor(
    @Inject(KbService) private readonly kb: KbService,
    @Inject(KbSearchService) private readonly searchService: KbSearchService,
    @Inject(CuratorJobsService) private readonly curator: CuratorJobsService,
  ) {}

  @McpTool({
    name: 'kb_list_spaces',
    title: 'KB: List spaces',
    description: 'List knowledge-base spaces in your org.',
    audiences: ['admin'],
    scopes: ['kb:read'],
    input: EmptyInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  listSpaces() {
    return this.kb.listSpaces();
  }

  @McpTool({
    name: 'kb_create_space',
    title: 'KB: Create space',
    description:
      'Create a new knowledge-base space. Slug must be unique within your org and only contain lowercase letters, digits and hyphens.',
    audiences: ['admin'],
    scopes: ['kb:write'],
    input: CreateSpaceInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  createSpace(args: z.infer<typeof CreateSpaceInput>) {
    return this.kb.createSpace(args);
  }

  @McpTool({
    name: 'kb_list_documents',
    title: 'KB: List documents',
    description:
      'List knowledge-base documents in your org, newest-updated first, with each document\'s `sourceUrl` (the public page it came from, or null). Bodies are not included; read one with `kb_get_document`. Optionally filter by space or tag.',
    audiences: ['admin'],
    scopes: ['kb:read'],
    input: ListDocumentsInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  listDocuments(args: z.infer<typeof ListDocumentsInput>) {
    return this.kb.listDocuments(args);
  }

  @McpTool({
    name: 'kb_get_document',
    title: 'KB: Read document',
    description:
      "Read one knowledge-base document, including its full body, tags, `sourceUrl` (the public page it came from, or null), and current version. End-user agents see only documents whose `audiences` includes `'self_service'`.",
    audiences: ['admin', 'self_service'],
    scopes: ['kb:read'],
    input: GetDocumentInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  getDocument(args: z.infer<typeof GetDocumentInput>) {
    return this.kb.getDocument(args.id);
  }

  @McpTool({
    name: 'kb_get_document_by_slug',
    title: 'KB: Read document by slug',
    description:
      "Read a knowledge-base document by its space slug and document slug — used when a stable identifier (e.g. 'agent-runtime/system-prompt') is needed instead of the document UUID. Returns null when the document does not exist.",
    audiences: ['admin'],
    scopes: ['kb:read'],
    input: GetDocumentBySlugInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  getDocumentBySlug(args: z.infer<typeof GetDocumentBySlugInput>) {
    return this.kb.getDocumentBySlug(args.spaceSlug, args.slug);
  }

  @McpTool({
    name: 'kb_search',
    title: 'KB: Search',
    description:
      "Search the knowledge base by natural-language query. Combines full-text search and vector similarity for the best of both. Each hit carries the document id, title, a matching excerpt, and `sourceUrl` — the public page the document came from, when it has one — so an answer can link to the source without a second read. End-user agents see only documents whose `audiences` includes `'self_service'`.",
    audiences: ['admin', 'self_service'],
    scopes: ['kb:read'],
    input: SearchInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  search(args: z.infer<typeof SearchInput>) {
    return this.searchService.search(args);
  }

  @McpTool({
    name: 'kb_create_document',
    title: 'KB: Create document',
    description:
      "Create a knowledge-base document inside a space. Body should be markdown. Set `audiences: ['admin', 'self_service']` to expose it to end-user agents; defaults to `['admin']` (admin-only). Set `sourceUrl` when the document mirrors a public page — a help-centre article, a product page — and answers drawn from it can link there.",
    audiences: ['admin'],
    scopes: ['kb:write'],
    input: CreateDocumentInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  createDocument(args: z.infer<typeof CreateDocumentInput>) {
    return this.kb.createDocument(args);
  }

  @McpTool({
    name: 'kb_export',
    title: 'KB: Export data',
    description:
      'Export this org\'s knowledge base (spaces and non-system documents) as a portable JSON payload. Pair with `kb_import` on another Munin server to move a knowledge base between self-hosted and cloud. Embeddings are not included — they are regenerated on import. Feed the returned `records` straight into `kb_import`.',
    audiences: ['admin'],
    scopes: ['kb:read'],
    input: EmptyInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  exportKb() {
    return this.kb.exportKb();
  }

  @McpTool({
    name: 'kb_import',
    title: 'KB: Import data',
    description:
      'Import knowledge-base `records` produced by `kb_export` (typically from another Munin server). Spaces are upserted by slug and documents by (space, slug) — or (space, title) when a document has no slug — so re-running is idempotent. Embeddings are regenerated here. Returns counts and an `idMap` (source id → id on this server); pass that `idMap` back into later imports so dependent records resolve their parents.',
    audiences: ['admin'],
    scopes: ['kb:write'],
    input: KbImportInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  importKb(args: z.infer<typeof KbImportInput>) {
    const records = {
      spaces: args.records.spaces.map((s) => ({ ...s, description: s.description ?? null })),
      documents: args.records.documents.map((d) => ({
        ...d,
        slug: d.slug ?? null,
        sourceUrl: d.sourceUrl ?? null,
      })),
    };
    return this.kb.importKb(records, args.idMap);
  }

  @McpTool({
    name: 'kb_import_website',
    title: 'KB: Import website',
    description:
      "Crawl a public website and populate the knowledge base from it: one KB document per page. Runs asynchronously on the curator queue — returns a job id you can track with the curator jobs control plane. Pass a homepage URL (a bare domain like `example.com` is accepted). The URL must be publicly reachable; localhost and private/internal addresses are rejected. Re-importing the same URL while a scrape is still pending returns the in-flight job instead of starting a second one.\n\nBy default the import also synthesizes a `company-profile` KB document (slug `company-profile`) that seeds the chat widget — appropriate when importing your own company's site. Set `synthesizeCompanyProfile: false` when importing third-party or topic pages that are NOT your company's website, so the import doesn't overwrite your company profile with unrelated content.\n\nReconciliation is on by default: after a healthy crawl, previously imported pages that are no longer on the site (re-checked individually and confirmed to return 404/410) are deleted from the knowledge base, so a refresh prunes removed pages. Set `reconcile: false` to import additively without pruning.",
    audiences: ['admin'],
    scopes: ['kb:write'],
    input: ImportWebsiteInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  async importWebsite(args: z.infer<typeof ImportWebsiteInput>) {
    const url = args.url.trim();
    const { job, alreadyPending } = await this.curator.enqueue({
      jobUri: WEB_SCRAPE_SITE_TASK_URI,
      userPrompt: url,
      sourceEventPayload: {
        synthesizeCompanyProfile: args.synthesizeCompanyProfile ?? true,
        reconcile: args.reconcile ?? true,
      },
      dedupeKey: `kb-import-website:${url}`,
      maxAttempts: 3,
    });
    return { jobId: job.id, status: job.status, alreadyPending };
  }

  @McpTool({
    name: 'kb_get_website_import_status',
    title: 'KB: Get website import status',
    description:
      'Check the progress of a website import started with `kb_import_website`, by the job id it returned. Status is one of `pending` (queued or running), `done` (finished — `summary` reports how many documents were imported), `failed_retryable`/`dead` (will retry / gave up), or `failed`. While `pending`, poll again after a short delay.',
    audiences: ['admin'],
    scopes: ['kb:read'],
    input: ImportWebsiteStatusInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  async importWebsiteStatus(args: z.infer<typeof ImportWebsiteStatusInput>) {
    const job = await this.curator.get(args.jobId);
    if (job.jobUri !== WEB_SCRAPE_SITE_TASK_URI) {
      throw new NotFoundException(`website import ${args.jobId} not found`);
    }
    return {
      jobId: job.id,
      url: job.userPrompt,
      status: job.status,
      done: job.status === 'done',
      attempts: job.attempts,
      maxAttempts: job.maxAttempts,
      summary: job.lastReplyText,
      error: job.lastError,
      doneAt: job.doneAt,
    };
  }

  @McpTool({
    name: 'kb_update_document',
    title: 'KB: Update document',
    description:
      'Update a knowledge-base document. Pass `ifVersion` (the current version you read) for optimistic concurrency; the call fails if it has changed. Omitted fields keep their current value; `sourceUrl: null` clears the recorded source page.',
    audiences: ['admin'],
    scopes: ['kb:write'],
    input: UpdateDocumentInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  updateDocument(args: z.infer<typeof UpdateDocumentInput>) {
    return this.kb.updateDocument(args);
  }

  @McpTool({
    name: 'kb_delete_document',
    title: 'KB: Delete document',
    description:
      'Delete a knowledge-base document. Pass `ifVersion` for optimistic concurrency. Cascades to chunks and versions. System-managed docs (e.g. the seeded `agent-runtime` prompts) cannot be deleted — edit their content with `kb_update_document` instead.',
    audiences: ['admin'],
    scopes: ['kb:write'],
    input: DeleteDocumentInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  deleteDocument(args: z.infer<typeof DeleteDocumentInput>) {
    return this.kb.deleteDocument(args);
  }

  @McpTool({
    name: 'kb_list_versions',
    title: 'KB: List document versions',
    description: 'List all prior versions of a knowledge-base document, newest first.',
    audiences: ['admin'],
    scopes: ['kb:read'],
    input: ListVersionsInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  listVersions(args: z.infer<typeof ListVersionsInput>) {
    return this.kb.listVersions(args.documentId);
  }

  @McpTool({
    name: 'kb_propose_curation_candidate',
    title: 'KB: Propose curation candidate',
    description:
      "File a draft FAQ-style document into the `kb-curation-inbox` KB space (admin audience only), for knowledge the KB does not cover at all. Used after a curation pass over resolved-handover conversations. The space is created on first use. See `skill://kb/review-content` for the procedure. To correct or extend a document that already exists, file `kb_propose_curation_revision` instead — it publishes as a new version of that document rather than a second one beside it. The candidate is NOT visible to end-user agents until it's promoted with `kb_publish_curation_candidate`. Fails with `kb_curation_decided` when a candidate from the same source message was already dismissed or published; a decision recorded before per-message curation shipped closes its whole conversation.",
    audiences: ['admin'],
    scopes: ['kb:write'],
    input: ProposeCurationCandidateInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  proposeCurationCandidate(args: z.infer<typeof ProposeCurationCandidateInput>) {
    return this.kb.proposeCurationCandidate(args);
  }

  @McpTool({
    name: 'kb_propose_curation_revision',
    title: 'KB: Propose curation revision',
    description:
      "File a proposed new body for a document that already exists, into the `kb-curation-inbox` KB space (admin audience only). Use it when what you learned corrects, contradicts or extends a document rather than filling a gap — a changed rate, a superseded policy, a missing exception. Pass the full proposed body, not a patch; the reviewer sees it as a diff against the document's current text. Publishing it with `kb_publish_curation_revision` writes a new version of that same document, so `kb_list_versions` and `kb_restore_version` can roll it back. Fails with `kb_curation_decided` when a candidate from the same source message was already dismissed or published.",
    audiences: ['admin'],
    scopes: ['kb:write'],
    input: ProposeCurationRevisionInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  proposeCurationRevision(args: z.infer<typeof ProposeCurationRevisionInput>) {
    return this.kb.proposeCurationRevision(args);
  }

  @McpTool({
    name: 'kb_list_curation_candidates',
    title: 'KB: List curation candidates',
    description:
      'List pending curation candidates awaiting review — drafts filed into the `kb-curation-inbox` space. Each row carries the source conversation id parsed from its tags, plus either a proposed target space slug (a new document) or `revisesDocumentId` with the revised document\'s current title and version (a proposed new version of an existing document). Bodies are not included; read one with `kb_get_document`. In hosts that support MCP Apps this renders an interactive review panel with per-candidate publish/dismiss actions.',
    audiences: ['admin'],
    scopes: ['kb:read'],
    input: ListCurationCandidatesInput,
    readOnlyHint: true,
    destructiveHint: false,
    _meta: { ui: { resourceUri: INSPECTOR_APP_URI }, 'ui/resourceUri': INSPECTOR_APP_URI },
  })
  listCurationCandidates(args: z.infer<typeof ListCurationCandidatesInput>) {
    return this.kb.listCurationCandidates(args.limit);
  }

  @McpTool({
    name: 'kb_dismiss_curation_candidate',
    title: 'KB: Dismiss curation candidate',
    description:
      'Reject a curation candidate: deletes the draft from the `kb-curation-inbox` space and records the decision, with an optional reason. The decision is permanent and scoped to the source conversation — later curation passes are refused when they try to file another candidate from it, so a rejected draft stays rejected instead of reappearing on the next weekly sweep. Pass `ifVersion` (the candidate `version` that was reviewed). Read past decisions with `kb_list_curation_decisions`.',
    audiences: ['admin'],
    scopes: ['kb:write'],
    input: DismissCurationCandidateInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  dismissCurationCandidate(args: z.infer<typeof DismissCurationCandidateInput>) {
    return this.kb.dismissCurationCandidate({
      id: args.candidateDocumentId,
      ifVersion: args.ifVersion,
      reason: args.reason,
    });
  }

  @McpTool({
    name: 'kb_list_curation_decisions',
    title: 'KB: List curation decisions',
    description:
      'List curation candidates that were already decided — dismissed (with the reason, when one was given) or published — newest first. Filter by `outcome` or `sourceConversationId`. A conversation that appears here is closed for curation: `kb_propose_curation_candidate` refuses further candidates from it.',
    audiences: ['admin'],
    scopes: ['kb:read'],
    input: ListCurationDecisionsInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  listCurationDecisions(args: z.infer<typeof ListCurationDecisionsInput>) {
    return this.kb.listCurationDecisions(args);
  }

  @McpTool({
    name: 'kb_publish_curation_candidate',
    title: 'KB: Publish curation candidate',
    description:
      "Promote a reviewed curation candidate into a target KB space as a new document. Copies the doc to the target space (default audiences `['admin', 'self_service']` so the self-service agent can find it), drops the curation tags, and removes the candidate from the inbox. The target space is created from the slug if it does not exist yet. Pass `ifVersion` (the candidate `version` that was reviewed) for optimistic concurrency; if the draft was edited since, the call fails and nothing is published. Refuses a candidate that proposes a revision to an existing document — use `kb_publish_curation_revision` for those.",
    audiences: ['admin'],
    scopes: ['kb:write'],
    input: PublishCurationCandidateInput,
    readOnlyHint: false,
    destructiveHint: true,
    _meta: { ui: { visibility: ['app'] } },
  })
  publishCurationCandidate(args: z.infer<typeof PublishCurationCandidateInput>) {
    return this.kb.publishCurationCandidate(args);
  }

  @McpTool({
    name: 'kb_publish_curation_revision',
    title: 'KB: Publish curation revision',
    description:
      'Apply a reviewed revision candidate to the document it revises, as a new version of that document, then remove the candidate from the inbox. Takes two versions: `ifCandidateVersion` binds the publish to the proposed text that was reviewed, and `ifDocumentVersion` binds it to the document text that was diffed against — if either moved since, the call fails and nothing is written. Roll back with `kb_restore_version`.',
    audiences: ['admin'],
    scopes: ['kb:write'],
    input: PublishCurationRevisionInput,
    readOnlyHint: false,
    destructiveHint: true,
    _meta: { ui: { visibility: ['app'] } },
  })
  publishCurationRevision(args: z.infer<typeof PublishCurationRevisionInput>) {
    return this.kb.publishCurationRevision(args);
  }

  @McpTool({
    name: 'kb_restore_version',
    title: 'KB: Restore document version',
    description:
      'Roll a document back to an earlier version. Creates a new current version with that historical content.',
    audiences: ['admin'],
    scopes: ['kb:write'],
    input: RestoreVersionInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  restoreVersion(args: z.infer<typeof RestoreVersionInput>) {
    return this.kb.restoreVersion(args);
  }
}
