import { Controller, Get, Inject, NotFoundException, Param, UseGuards } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AllowAnonymous } from '../common/auth/auth.guard.js';
import { McpSkillRegistryService } from '../mcp/mcp.skill-registry.service.js';

interface PublicSkillListItem {
  uri: string;
  module: string;
  slug: string;
  title: string;
  description: string;
}

interface PublicSkillDetail extends PublicSkillListItem {
  content: string;
  mimeType: string;
}

@Controller('api/v1/public/skills')
@AllowAnonymous()
@UseGuards(ThrottlerGuard)
export class PublicSkillsController {
  constructor(
    @Inject(McpSkillRegistryService) private readonly skills: McpSkillRegistryService,
  ) {}

  @Get()
  list(): PublicSkillListItem[] {
    return this.skills.listPublic().map(toListItem);
  }

  @Get(':module/:slug')
  read(@Param('module') module: string, @Param('slug') slug: string): PublicSkillDetail {
    const uri = `skill://${module}/${slug}`;
    const skill = this.skills.get(uri);
    if (!skill || !skill.public) throw new NotFoundException(`Skill ${uri} not found`);
    return {
      ...toListItem(skill),
      content: skill.content,
      mimeType: skill.mimeType,
    };
  }
}

function toListItem(skill: { uri: string; name: string; description: string }): PublicSkillListItem {
  const [, , module, slug] = skill.uri.split('/');
  return {
    uri: skill.uri,
    module: module ?? '',
    slug: slug ?? '',
    title: skill.name,
    description: skill.description,
  };
}
