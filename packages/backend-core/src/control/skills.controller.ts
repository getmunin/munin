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
  jobKindOf,
  tierFor,
  type JobKind,
  type ModelTier,
} from '@getmunin/types';
import { AuthGuard } from '../common/auth/auth.guard.ts';
import { TenancyInterceptor } from '../common/tenancy/tenancy.interceptor.ts';
import { AuditInterceptor } from '../common/audit/audit.interceptor.ts';
import { McpSkillRegistryService } from '../mcp/mcp.skill-registry.service.ts';
import { toIsoString } from '../common/iso.ts';

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
      job_uri: string;
      status: string;
      done_at: Date | string | null;
      updated_at: Date | string;
    }>(sql`
      SELECT DISTINCT ON (job_uri) job_uri, status, done_at, updated_at
      FROM ${schema.curatorJobs}
      WHERE org_id = ${actor.orgId}
      ORDER BY job_uri, updated_at DESC
    `);
    const latestByUri = new Map<string, { lastRunAt: string | null; status: string }>();
    for (const r of rows) {
      latestByUri.set(r.job_uri, {
        lastRunAt: toIsoString(r.done_at ?? r.updated_at),
        status: r.status,
      });
    }

    const dtos: SkillDto[] = [];
    for (const entry of this.registry.list('admin')) {
      const kind = jobKindOf(entry.uri);
      if (kind === 'skill' && !KNOWN_SKILL_URIS.has(entry.uri)) continue;
      if (!kind) continue;
      const latest = latestByUri.get(entry.uri);
      dtos.push({
        uri: entry.uri,
        kind,
        name: entry.name,
        description: firstSentence(entry.description),
        audiences: entry.audiences,
        tier: tierFor(entry.uri),
        lastRunAt: latest?.lastRunAt ?? null,
        lastRunStatus: latest ? normalizeStatus(latest.status) : null,
      });
    }
    dtos.sort((a, b) => a.name.localeCompare(b.name));
    return dtos;
  }
}

function firstSentence(description: string): string {
  const trimmed = description.trim();
  if (!trimmed) return '';
  const match = /^.+?[.!?](?=\s|$)/.exec(trimmed);
  return (match ? match[0] : trimmed).trim();
}

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
