import { Inject, Injectable } from '@nestjs/common';
import { schema } from '@getmunin/db';
import { and, eq, isNotNull, ne, notInArray, notLike, or, sql } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import {
  AGENT_HOST_ACTOR,
  AGENT_HOST_ACTOR_PREFIX,
  SYSTEM_ACTOR_IDS,
} from '@getmunin/types';
import {
  AGENT_RUNTIME_PROMPT_SPACE_SLUG,
  COMPANY_PROFILE_SPACE_SLUG,
  getCurrentContext,
} from '@getmunin/core';
import { ConvService, type ChannelDto } from '../modules/conv/conv.service.ts';
import { CURATION_INBOX_SLUG } from '../modules/kb/kb.service.ts';
import { toIsoString } from '../common/iso.ts';

const RESERVED_KB_SPACE_SLUGS = [
  CURATION_INBOX_SLUG,
  AGENT_RUNTIME_PROMPT_SPACE_SLUG,
  COMPANY_PROFILE_SPACE_SLUG,
];

export interface SetupStateDto {
  channels: ChannelDto[];
  conversationCount: number;
  topicCount: number;
  knowledgeDocumentCount: number;
  externalMcpCallCount: number;
  lastExternalMcpCallAt: string | null;
}

@Injectable()
export class SetupStateService {
  constructor(@Inject(ConvService) private readonly conv: ConvService) {}

  async read(): Promise<SetupStateDto> {
    const [channels, conversationCount, topicCount, knowledgeDocumentCount, mcp] =
      await Promise.all([
        this.conv.listChannels(),
        countRows(schema.convConversations),
        countRows(schema.convTopics),
        this.countKnowledgeDocuments(),
        this.readExternalMcpActivity(),
      ]);

    return {
      channels,
      conversationCount,
      topicCount,
      knowledgeDocumentCount,
      externalMcpCallCount: mcp.count,
      lastExternalMcpCallAt: mcp.lastAt,
    };
  }

  private async countKnowledgeDocuments(): Promise<number> {
    const ctx = getCurrentContext();
    const [row] = await ctx.db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.kbDocuments)
      .innerJoin(schema.kbSpaces, eq(schema.kbSpaces.id, schema.kbDocuments.spaceId))
      .where(
        and(
          notInArray(schema.kbSpaces.slug, RESERVED_KB_SPACE_SLUGS),
          eq(schema.kbDocuments.isSystem, false),
        ),
      );
    return row?.n ?? 0;
  }

  private async readExternalMcpActivity(): Promise<{ count: number; lastAt: string | null }> {
    const ctx = getCurrentContext();
    const [row] = await ctx.db
      .select({
        n: sql<number>`count(*)::int`,
        lastAt: sql<Date | string | null>`max(${schema.auditLog.createdAt})`,
      })
      .from(schema.auditLog)
      .where(
        and(
          isNotNull(schema.auditLog.tool),
          ne(schema.auditLog.actorType, 'system'),
          or(
            isNotNull(schema.auditLog.clientId),
            and(
              isNotNull(schema.auditLog.actorId),
              ne(schema.auditLog.actorId, AGENT_HOST_ACTOR),
              notLike(schema.auditLog.actorId, `${AGENT_HOST_ACTOR_PREFIX}%`),
              notInArray(schema.auditLog.actorId, [...SYSTEM_ACTOR_IDS]),
            ),
          ),
        ),
      );
    return { count: row?.n ?? 0, lastAt: toIsoString(row?.lastAt ?? null) };
  }
}

async function countRows(table: PgTable): Promise<number> {
  const ctx = getCurrentContext();
  const [row] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(table);
  return row?.n ?? 0;
}
