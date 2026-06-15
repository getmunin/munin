import { Injectable, OnModuleInit } from '@nestjs/common';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SkillRegistry } from '@getmunin/mcp-toolkit';
import type { Audience } from '@getmunin/core';
import { loadSkills, type SkillSource } from './skill-loader.ts';
import { mcpResourceOrigin } from '../oauth/oauth.constants.ts';

@Injectable()
export class McpSkillRegistryService extends SkillRegistry implements OnModuleInit {
  private cachedInstructions: string | null = null;

  onModuleInit(): void {
    const here = dirname(fileURLToPath(import.meta.url));
    const modulesRoot = join(here, '..', 'modules');
    const sources: SkillSource[] = [{ root: modulesRoot }];
    for (const skill of loadSkills(sources)) {
      this.register(skill);
    }
    this.cachedInstructions = buildInstructions(
      this.list('admin').filter((s) => s.uri.startsWith('skill://')),
      mcpResourceOrigin(),
    );
  }

  instructions(): string {
    return this.cachedInstructions ?? '';
  }
}

function buildInstructions(
  adminSkills: ReadonlyArray<{ uri: string; name: string }>,
  apiBaseUrl: string,
): string {
  const playbooks = adminSkills.filter((s) => s.uri.startsWith('skill://playbooks/'));
  const rest = adminSkills.filter((s) => !s.uri.startsWith('skill://playbooks/'));
  const featured = [...playbooks, ...rest].slice(0, 8);
  const lines = [
    `This Munin tenant's API base URL is ${apiBaseUrl} — it serves /widget.js, /tracker.js,`,
    '/v1/cms/* and this /mcp endpoint. Use it directly when scaffolding a frontend; do not ask',
    'for it. Skill bodies have it (and your org id) pre-filled.',
    '',
    'Munin: agent-native business apps. You have ~80 tools across these modules:',
    '  • Knowledge Base (kb_*)        — articles, search, versions',
    '  • Conversations (conv_*)       — channels, messages, assignments',
    '  • CRM (crm_*)                  — contacts, companies, deals, activities',
    '  • CMS (cms_*)                  — collections, entries, assets, locales',
    '  • Analytics (analytics_*)      — tracker keys, page-view + search events',
    '  • Org & access                 — api_keys, end_users, invitations, members, memberships',
    '',
    'Multi-step workflows have detailed skills. Call `resources/list` to discover',
    'them (URIs use the `skill://` scheme), then `resources/read` to fetch one.',
    'If your client does not expose MCP resources, use the `skills_list` and',
    '`skills_read` tools instead — same content, same URIs.',
    'Cross-module workflows live under `skill://playbooks/*`.',
  ];
  if (featured.length > 0) {
    lines.push('', 'Frequently relevant for admin agents:');
    for (const skill of featured) {
      lines.push(`  • ${skill.uri}  — ${skill.name}`);
    }
  }
  return lines.join('\n');
}

export function audienceFromActor(audiences: readonly Audience[]): Audience {
  return audiences.includes('admin') ? 'admin' : 'self_service';
}
