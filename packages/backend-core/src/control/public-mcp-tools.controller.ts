import { Controller, Get, Inject, NotFoundException, Param, UseGuards } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AllowAnonymous } from '../common/auth/auth.guard.ts';
import { McpRegistryService } from '../mcp/mcp.registry.ts';
import type { RegisteredMcpTool } from '@getmunin/mcp-toolkit';

interface PublicMcpToolListItem {
  name: string;
  title?: string;
  description: string;
  audiences: readonly string[];
  scopes: readonly string[];
  danger: 'destructive' | 'writes' | null;
  readOnly: boolean;
}

interface PublicMcpToolDetail extends PublicMcpToolListItem {
  inputSchema: object;
}

@Controller('api/v1/public/mcp-tools')
@AllowAnonymous()
@UseGuards(ThrottlerGuard)
export class PublicMcpToolsController {
  constructor(@Inject(McpRegistryService) private readonly registry: McpRegistryService) {}

  @Get()
  list(): PublicMcpToolListItem[] {
    return this.registry.list().map(toListItem);
  }

  @Get(':name')
  read(@Param('name') name: string): PublicMcpToolDetail {
    const tool = this.registry.get(name);
    if (!tool) throw new NotFoundException(`MCP tool ${name} not found`);
    return { ...toListItem(tool), inputSchema: tool.inputJsonSchema };
  }
}

function toListItem(tool: RegisteredMcpTool): PublicMcpToolListItem {
  const { meta } = tool;
  const danger: PublicMcpToolListItem['danger'] = meta.destructiveHint
    ? 'destructive'
    : meta.readOnlyHint
      ? null
      : 'writes';
  return {
    name: meta.name,
    title: meta.title,
    description: meta.description,
    audiences: meta.audiences,
    scopes: meta.scopes,
    danger,
    readOnly: meta.readOnlyHint === true,
  };
}
