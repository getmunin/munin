import { Controller, Get, Inject, NotFoundException, Param } from '@nestjs/common';
import { AllowAnonymous } from '../common/auth/auth.guard.js';
import { McpRunbookRegistryService } from '../mcp/mcp.runbook-registry.service.js';

interface PublicRunbookListItem {
  uri: string;
  module: string;
  slug: string;
  title: string;
  description: string;
}

interface PublicRunbookDetail extends PublicRunbookListItem {
  content: string;
  mimeType: string;
}

@Controller('api/public/runbooks')
@AllowAnonymous()
export class PublicRunbooksController {
  constructor(
    @Inject(McpRunbookRegistryService) private readonly runbooks: McpRunbookRegistryService,
  ) {}

  @Get()
  list(): PublicRunbookListItem[] {
    return this.runbooks.listPublic().map(toListItem);
  }

  @Get(':module/:slug')
  read(@Param('module') module: string, @Param('slug') slug: string): PublicRunbookDetail {
    const uri = `runbook://${module}/${slug}`;
    const rb = this.runbooks.get(uri);
    if (!rb || !rb.public) throw new NotFoundException(`Runbook ${uri} not found`);
    return {
      ...toListItem(rb),
      content: rb.content,
      mimeType: rb.mimeType,
    };
  }
}

function toListItem(rb: { uri: string; name: string; description: string }): PublicRunbookListItem {
  const [, , module, slug] = rb.uri.split('/');
  return {
    uri: rb.uri,
    module: module ?? '',
    slug: slug ?? '',
    title: rb.name,
    description: rb.description,
  };
}
