import { Injectable, OnModuleInit } from '@nestjs/common';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SkillRegistry } from '@getmunin/mcp-toolkit';
import type { Audience } from '@getmunin/core';
import { loadSkills, type SkillSource } from './skill-loader.js';

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
    );
  }

  instructions(): string {
    return this.cachedInstructions ?? '';
  }
}

function buildInstructions(adminSkills: ReadonlyArray<{ uri: string; name: string }>): string {
  const featured = adminSkills.slice(0, 6);
  const lines = [
    'Munin: agent-native business apps. You have ~80 tools across these modules:',
    '  • Knowledge Base (kb_*)        — articles, search, versions',
    '  • Conversations (conv_*)       — channels, messages, assignments',
    '  • CRM (crm_*)                  — contacts, companies, deals, activities',
    '  • CMS (cms_*)                  — collections, entries, assets, locales',
    '  • Org & access                 — api_keys, end_users, invitations, members, memberships',
    '',
    'Multi-step workflows have detailed skills. Call `resources/list` to discover',
    'them (URIs use the `skill://` scheme), then `resources/read` to fetch one.',
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
