import {
  Controller,
  Get,
  Inject,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { schema } from '@getmunin/db';
import { sql } from 'drizzle-orm';
import { getCurrentContext } from '@getmunin/core';
import {
  KNOWN_SKILL_URIS,
  KNOWN_TASK_URIS,
  tierFor,
  type JobKind,
  type ModelTier,
} from '@getmunin/types';
import { AuthGuard } from '../common/auth/auth.guard.js';
import { TenancyInterceptor } from '../common/tenancy/tenancy.interceptor.js';
import { AuditInterceptor } from '../common/audit/audit.interceptor.js';
import { McpSkillRegistryService } from '../mcp/mcp.skill-registry.service.js';
import { toIsoString } from '../common/iso.js';

interface SkillDto {
  uri: string;
  kind: JobKind;
  name: string;
  description: string;
  audiences: readonly string[];
  tier: ModelTier;
  lastRunAt: string | null;
  lastRunStatus: 'pending' | 'running' | 'done' | 'failed' | 'dead' | null;
}

@Controller('api/v1/skills')
@UseGuards(AuthGuard)
@UseInterceptors(TenancyInterceptor, AuditInterceptor)
export class SkillsController {
  constructor(
    @Inject(McpSkillRegistryService) private readonly registry: McpSkillRegistryService,
  ) {}

  @Get()
  async list(): Promise<SkillDto[]> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const rows = await ctx.db.execute<{
      skill_uri: string;
      status: string;
      done_at: Date | string | null;
      updated_at: Date | string;
    }>(sql`
      SELECT DISTINCT ON (skill_uri) skill_uri, status, done_at, updated_at
      FROM ${schema.curatorJobs}
      WHERE org_id = ${actor.orgId}
      ORDER BY skill_uri, updated_at DESC
    `);
    const latestByUri = new Map<string, { lastRunAt: string | null; status: string }>();
    for (const r of rows) {
      latestByUri.set(r.skill_uri, {
        lastRunAt: toIsoString(r.done_at ?? r.updated_at),
        status: r.status,
      });
    }

    const dtos: SkillDto[] = [];
    for (const skill of this.registry.list('admin')) {
      if (!KNOWN_SKILL_URIS.has(skill.uri)) continue;
      const latest = latestByUri.get(skill.uri);
      dtos.push({
        uri: skill.uri,
        kind: 'skill',
        name: skill.name,
        description: skill.description,
        audiences: skill.audiences,
        tier: tierFor(skill.uri),
        lastRunAt: latest?.lastRunAt ?? null,
        lastRunStatus: latest ? normalizeStatus(latest.status) : null,
      });
    }
    for (const uri of KNOWN_TASK_URIS) {
      const meta = TASK_METADATA[uri];
      if (!meta) continue;
      const latest = latestByUri.get(uri);
      dtos.push({
        uri,
        kind: 'task',
        name: meta.name,
        description: meta.description,
        audiences: ['admin'],
        tier: tierFor(uri),
        lastRunAt: latest?.lastRunAt ?? null,
        lastRunStatus: latest ? normalizeStatus(latest.status) : null,
      });
    }
    return dtos;
  }
}

const TASK_METADATA: Record<string, { name: string; description: string }> = {
  'task://web/scrape-site': {
    name: 'Website import',
    description:
      "Crawl a customer's public website, populate the KB with per-page docs, and synthesize a company-profile document.",
  },
};

function normalizeStatus(s: string): SkillDto['lastRunStatus'] {
  switch (s) {
    case 'pending':
    case 'running':
    case 'done':
    case 'failed':
    case 'dead':
      return s;
    default:
      return null;
  }
}
