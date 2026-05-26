import { Controller, Get, Header, UseGuards, UseInterceptors } from '@nestjs/common';
import { schema } from '@getmunin/db';
import { eq } from 'drizzle-orm';
import { getCurrentContext } from '@getmunin/core';
import { AuthGuard } from '../common/auth/auth.guard.ts';
import { TenancyInterceptor } from '../common/tenancy/tenancy.interceptor.ts';
import { AuditInterceptor } from '../common/audit/audit.interceptor.ts';
import { assertOwnerOrAdmin } from './role-guard.ts';

interface ExportPayload {
  exportedAt: string;
  org: unknown;
  endUsers: unknown[];
  agents: unknown[];
  kbSpaces: unknown[];
  kbDocuments: unknown[];
  kbDocumentVersions: unknown[];
}

/**
 * Right-to-export. Returns a complete JSON dump of the org's domain rows
 * (everything that's safe to give back to the customer, omitting hashes,
 * raw embeddings, and other internals). Tokens, API keys, and audit log
 * are deliberately not exported — those are credentials/operational data,
 * not user content.
 */
@Controller('v1/export')
@UseGuards(AuthGuard)
@UseInterceptors(TenancyInterceptor, AuditInterceptor)
export class ExportController {
  @Get()
  @Header('content-disposition', 'attachment; filename="munin-export.json"')
  async export(): Promise<ExportPayload> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    await assertOwnerOrAdmin(actor.orgId, actor.userId ?? actor.id);

    const [org, endUsers, agents, kbSpaces, kbDocuments, kbDocumentVersions] =
      await Promise.all([
        ctx.db.select().from(schema.orgs).where(eq(schema.orgs.id, actor.orgId)).limit(1),
        ctx.db.select().from(schema.endUsers).where(eq(schema.endUsers.orgId, actor.orgId)),
        ctx.db.select().from(schema.agents).where(eq(schema.agents.orgId, actor.orgId)),
        ctx.db.select().from(schema.kbSpaces).where(eq(schema.kbSpaces.orgId, actor.orgId)),
        ctx.db
          .select({
            id: schema.kbDocuments.id,
            spaceId: schema.kbDocuments.spaceId,
            title: schema.kbDocuments.title,
            body: schema.kbDocuments.body,
            audiences: schema.kbDocuments.audiences,
            version: schema.kbDocuments.version,
            tags: schema.kbDocuments.tags,
            createdAt: schema.kbDocuments.createdAt,
            updatedAt: schema.kbDocuments.updatedAt,
          })
          .from(schema.kbDocuments)
          .where(eq(schema.kbDocuments.orgId, actor.orgId)),
        ctx.db
          .select()
          .from(schema.kbDocumentVersions)
          .where(eq(schema.kbDocumentVersions.orgId, actor.orgId)),
      ]);

    return {
      exportedAt: new Date().toISOString(),
      org: org[0] ?? null,
      endUsers,
      agents,
      kbSpaces,
      kbDocuments,
      kbDocumentVersions,
    };
  }
}
