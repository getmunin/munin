import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { McpTool } from '@getmunin/mcp-toolkit';
import { KbService } from './kb.service.js';
import { KbSearchService } from './kb.search.js';

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

const CreateDocumentInput = z.object({
  spaceId: z.string(),
  title: z.string().min(1).max(300),
  body: z.string().min(1),
  audiences: AudiencesSchema.optional(),
  tags: TagsSchema.optional(),
  slug: z.string().min(1).max(64).optional(),
});

const UpdateDocumentInput = z.object({
  id: z.string(),
  ifVersion: z.number().int().nonnegative(),
  title: z.string().min(1).max(300).optional(),
  body: z.string().min(1).optional(),
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

const PublishCurationCandidateInput = z.object({
  candidateDocumentId: z.string().min(1),
  targetSpaceSlug: z.string().min(1).max(64),
  audiences: AudiencesSchema.optional(),
});

const EmptyInput = z.object({});

@Injectable()
export class KbAdminTools {
  constructor(
    @Inject(KbService) private readonly kb: KbService,
    @Inject(KbSearchService) private readonly searchService: KbSearchService,
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
    destructiveHint: false,
  })
  createSpace(args: z.infer<typeof CreateSpaceInput>) {
    return this.kb.createSpace(args);
  }

  @McpTool({
    name: 'kb_list_documents',
    title: 'KB: List documents',
    description:
      'List knowledge-base documents in your org, newest-updated first. Optionally filter by space or tag.',
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
      "Read one knowledge-base document, including its full body, tags, and current version. End-user agents see only documents whose `audiences` includes `'self_service'`.",
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
      "Search the knowledge base by natural-language query. Combines full-text search and vector similarity for the best of both. End-user agents see only documents whose `audiences` includes `'self_service'`.",
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
      "Create a knowledge-base document inside a space. Body should be markdown. Set `audiences: ['admin', 'self_service']` to expose it to end-user agents; defaults to `['admin']` (admin-only).",
    audiences: ['admin'],
    scopes: ['kb:write'],
    input: CreateDocumentInput,
    readOnlyHint: false,
    destructiveHint: false,
  })
  createDocument(args: z.infer<typeof CreateDocumentInput>) {
    return this.kb.createDocument(args);
  }

  @McpTool({
    name: 'kb_update_document',
    title: 'KB: Update document',
    description:
      'Update a knowledge-base document. Pass `ifVersion` (the current version you read) for optimistic concurrency; the call fails if it has changed.',
    audiences: ['admin'],
    scopes: ['kb:write'],
    input: UpdateDocumentInput,
    readOnlyHint: false,
    destructiveHint: false,
  })
  updateDocument(args: z.infer<typeof UpdateDocumentInput>) {
    return this.kb.updateDocument(args);
  }

  @McpTool({
    name: 'kb_delete_document',
    title: 'KB: Delete document',
    description:
      'Delete a knowledge-base document. Pass `ifVersion` for optimistic concurrency. Cascades to chunks and versions.',
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
      "File a draft FAQ-style document into the `kb-curation-inbox` KB space (admin audience only). Used after a curation pass over resolved-handover conversations. The space is created on first use. See `skill://kb/review-content` for the procedure. The candidate is NOT visible to end-user agents until it's promoted with `kb_publish_curation_candidate`.",
    audiences: ['admin'],
    scopes: ['kb:write'],
    input: ProposeCurationCandidateInput,
    readOnlyHint: false,
    destructiveHint: false,
  })
  proposeCurationCandidate(args: z.infer<typeof ProposeCurationCandidateInput>) {
    return this.kb.proposeCurationCandidate(args);
  }

  @McpTool({
    name: 'kb_publish_curation_candidate',
    title: 'KB: Publish curation candidate',
    description:
      "Promote a reviewed curation candidate into a target KB space. Copies the doc to the target space (default audiences `['admin', 'self_service']` so the self-service agent can find it), drops the `curation`/`candidate` tags, and removes the candidate from the inbox. The target space must already exist.",
    audiences: ['admin'],
    scopes: ['kb:write'],
    input: PublishCurationCandidateInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  publishCurationCandidate(args: z.infer<typeof PublishCurationCandidateInput>) {
    return this.kb.publishCurationCandidate(args);
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
