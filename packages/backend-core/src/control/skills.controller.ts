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
import { AuthGuard } from '../common/auth/auth.guard.js';
import { TenancyInterceptor } from '../common/tenancy/tenancy.interceptor.js';
import { AuditInterceptor } from '../common/audit/audit.interceptor.js';
import { McpSkillRegistryService } from '../mcp/mcp.skill-registry.service.js';
import { toIsoString } from '../common/iso.js';

export type SkillTier = 'fast' | 'smart';

interface SkillDto {
  uri: string;
  name: string;
  description: string;
  audiences: readonly string[];
  tier: SkillTier;
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

    return this.registry.list('admin').map((skill): SkillDto => {
      const latest = latestByUri.get(skill.uri);
      return {
        uri: skill.uri,
        name: skill.name,
        description: skill.description,
        audiences: skill.audiences,
        tier: tierFor(skill.uri),
        lastRunAt: latest?.lastRunAt ?? null,
        lastRunStatus: latest ? normalizeStatus(latest.status) : null,
      };
    });
  }
}

/**
 * Mirror of `modelTierFor` in `packages/agent-host/src/runner.service.ts`.
 * That function is the source of truth for actual routing decisions at
 * runtime; this duplicate exists because `agent-host` depends on
 * `backend-core` (importing the other way would be circular). Keep in sync —
 * if you add a fast-tier skill in `runner.service.ts`, mirror it here.
 */
export function tierFor(skillUri: string): SkillTier {
  if (skillUri === 'skill://conv/strip-email-signature') return 'fast';
  return 'smart';
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

