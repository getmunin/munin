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

const CreateDocumentInput = z.object({
  spaceId: z.string(),
  title: z.string().min(1).max(300),
  body: z.string().min(1),
  public: z.boolean().optional(),
  tags: TagsSchema.optional(),
});

const UpdateDocumentInput = z.object({
  id: z.string(),
  ifVersion: z.number().int().nonnegative(),
  title: z.string().min(1).max(300).optional(),
  body: z.string().min(1).optional(),
  public: z.boolean().optional(),
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

const EmptyInput = z.object({});

@Injectable()
export class KbAdminTools {
  constructor(
    @Inject(KbService) private readonly kb: KbService,
    @Inject(KbSearchService) private readonly searchService: KbSearchService,
  ) {}

  @McpTool({
    name: 'kb_list_spaces',
    description: 'List knowledge-base spaces in your org.',
    audiences: ['admin'],
    scopes: ['kb:read'],
    input: EmptyInput,
  })
  listSpaces() {
    return this.kb.listSpaces();
  }

  @McpTool({
    name: 'kb_create_space',
    description:
      'Create a new knowledge-base space. Slug must be unique within your org and only contain lowercase letters, digits and hyphens.',
    audiences: ['admin'],
    scopes: ['kb:write'],
    input: CreateSpaceInput,
  })
  createSpace(args: z.infer<typeof CreateSpaceInput>) {
    return this.kb.createSpace(args);
  }

  @McpTool({
    name: 'kb_list_documents',
    description:
      'List knowledge-base documents in your org, newest-updated first. Optionally filter by space or tag.',
    audiences: ['admin'],
    scopes: ['kb:read'],
    input: ListDocumentsInput,
  })
  listDocuments(args: z.infer<typeof ListDocumentsInput>) {
    return this.kb.listDocuments(args);
  }

  @McpTool({
    name: 'kb_get_document',
    description:
      'Read one knowledge-base document, including its full body, tags, and current version. End-user agents see only documents marked `public`.',
    audiences: ['admin', 'self_service'],
    scopes: ['kb:read'],
    input: GetDocumentInput,
  })
  getDocument(args: z.infer<typeof GetDocumentInput>) {
    return this.kb.getDocument(args.id);
  }

  @McpTool({
    name: 'kb_search',
    description:
      'Search the knowledge base by natural-language query. Combines full-text search and vector similarity for the best of both. End-user agents see only documents marked `public`.',
    audiences: ['admin', 'self_service'],
    scopes: ['kb:read'],
    input: SearchInput,
  })
  search(args: z.infer<typeof SearchInput>) {
    return this.searchService.search(args);
  }

  @McpTool({
    name: 'kb_create_document',
    description:
      'Create a knowledge-base document inside a space. Body should be markdown. Set `public: true` to expose it to end-user agents.',
    audiences: ['admin'],
    scopes: ['kb:write'],
    input: CreateDocumentInput,
  })
  createDocument(args: z.infer<typeof CreateDocumentInput>) {
    return this.kb.createDocument(args);
  }

  @McpTool({
    name: 'kb_update_document',
    description:
      'Update a knowledge-base document. Pass `ifVersion` (the current version you read) for optimistic concurrency; the call fails if it has changed.',
    audiences: ['admin'],
    scopes: ['kb:write'],
    input: UpdateDocumentInput,
  })
  updateDocument(args: z.infer<typeof UpdateDocumentInput>) {
    return this.kb.updateDocument(args);
  }

  @McpTool({
    name: 'kb_delete_document',
    description:
      'Delete a knowledge-base document. Pass `ifVersion` for optimistic concurrency. Cascades to chunks and versions.',
    audiences: ['admin'],
    scopes: ['kb:write'],
    input: DeleteDocumentInput,
  })
  deleteDocument(args: z.infer<typeof DeleteDocumentInput>) {
    return this.kb.deleteDocument(args);
  }

  @McpTool({
    name: 'kb_list_versions',
    description: 'List all prior versions of a knowledge-base document, newest first.',
    audiences: ['admin'],
    scopes: ['kb:read'],
    input: ListVersionsInput,
  })
  listVersions(args: z.infer<typeof ListVersionsInput>) {
    return this.kb.listVersions(args.documentId);
  }

  @McpTool({
    name: 'kb_restore_version',
    description:
      'Roll a document back to an earlier version. Creates a new current version with that historical content.',
    audiences: ['admin'],
    scopes: ['kb:write'],
    input: RestoreVersionInput,
  })
  restoreVersion(args: z.infer<typeof RestoreVersionInput>) {
    return this.kb.restoreVersion(args);
  }
}
