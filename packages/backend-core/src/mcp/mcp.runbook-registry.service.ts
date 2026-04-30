import { Injectable, OnModuleInit } from '@nestjs/common';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RunbookRegistry } from '@getmunin/mcp-toolkit';
import type { Audience } from '@getmunin/core';
import { loadRunbooks, type RunbookSource } from './runbook-loader.js';

@Injectable()
export class McpRunbookRegistryService extends RunbookRegistry implements OnModuleInit {
  private cachedInstructions: string | null = null;

  onModuleInit(): void {
    const here = dirname(fileURLToPath(import.meta.url));
    const modulesRoot = join(here, '..', 'modules');
    const sources: RunbookSource[] = [{ root: modulesRoot }];
    for (const rb of loadRunbooks(sources)) {
      this.register(rb);
    }
    this.cachedInstructions = buildInstructions(this.list('admin'));
  }

  instructions(): string {
    return this.cachedInstructions ?? '';
  }
}

function buildInstructions(adminRunbooks: ReadonlyArray<{ uri: string; name: string }>): string {
  const featured = adminRunbooks.slice(0, 6);
  const lines = [
    'Munin: agent-native business apps. You have ~80 tools across these modules:',
    '  • Knowledge Base (kb_*)        — articles, search, versions',
    '  • Conversations (conv_*)       — channels, messages, assignments',
    '  • CRM (crm_*)                  — contacts, companies, deals, activities',
    '  • CMS (cms_*)                  — collections, entries, assets, locales',
    '  • Org & access                 — api_keys, end_users, invitations, members, memberships',
    '',
    'Multi-step workflows have detailed runbooks. Call `resources/list` to discover',
    'them (URIs use the `runbook://` scheme), then `resources/read` to fetch one.',
  ];
  if (featured.length > 0) {
    lines.push('', 'Frequently relevant for admin agents:');
    for (const rb of featured) {
      lines.push(`  • ${rb.uri}  — ${rb.name}`);
    }
  }
  return lines.join('\n');
}

export function audienceFromActor(audiences: readonly Audience[]): Audience {
  return audiences.includes('admin') ? 'admin' : 'self_service';
}
