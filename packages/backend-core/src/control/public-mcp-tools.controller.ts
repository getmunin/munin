import { Get, Inject, NotFoundException, Param } from '@nestjs/common';
import { PublicController } from '../common/auth/auth.guard.ts';
import { McpRegistryService } from '../mcp/mcp.registry.ts';
import {
  SKILL_TOOLS,
  getSkillToolDescriptor,
  type RegisteredMcpTool,
  type SkillToolDescriptor,
} from '@getmunin/mcp-toolkit';

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

@PublicController('v1/public/mcp-tools', { throttle: true })
export class PublicMcpToolsController {
  constructor(@Inject(McpRegistryService) private readonly registry: McpRegistryService) {}

  @Get()
  list(): PublicMcpToolListItem[] {
    return [...this.registry.list().map(toListItem), ...SKILL_TOOLS.map(skillToListItem)];
  }

  @Get(':name')
  read(@Param('name') name: string): PublicMcpToolDetail {
    const skill = getSkillToolDescriptor(name);
    if (skill) return { ...skillToListItem(skill), inputSchema: skill.inputSchema };
    const tool = this.registry.get(name);
    if (!tool) throw new NotFoundException(`MCP tool ${name} not found`);
    return { ...toListItem(tool), inputSchema: tool.inputJsonSchema };
  }
}

function dangerOf(readOnlyHint?: boolean, destructiveHint?: boolean): PublicMcpToolListItem['danger'] {
  return destructiveHint ? 'destructive' : readOnlyHint ? null : 'writes';
}

function toListItem(tool: RegisteredMcpTool): PublicMcpToolListItem {
  const { meta } = tool;
  return {
    name: meta.name,
    title: meta.title,
    description: meta.description,
    audiences: meta.audiences,
    scopes: meta.scopes,
    danger: dangerOf(meta.readOnlyHint, meta.destructiveHint),
    readOnly: meta.readOnlyHint === true,
  };
}

function skillToListItem(tool: SkillToolDescriptor): PublicMcpToolListItem {
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    audiences: tool.audiences,
    scopes: tool.scopes,
    danger: dangerOf(tool.readOnlyHint, tool.destructiveHint),
    readOnly: tool.readOnlyHint,
  };
}
