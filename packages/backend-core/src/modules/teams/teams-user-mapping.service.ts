import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { schema, type Db } from '@getmunin/db';
import { describeError } from '@getmunin/core';
import { DB } from '../../common/db/db.module.ts';
import { findOrgMemberByEmail, isOrgMember } from '../operator-bridge/bridge-member-match.ts';
import { TeamsApiClient, type TeamsBotCredentials } from './teams-api.client.ts';

type IntegrationRow = typeof schema.teamsIntegrations.$inferSelect;

export interface TeamsSender {
  id: string;
  aadObjectId?: string;
}

@Injectable()
export class TeamsUserMappingService {
  private readonly logger = new Logger(TeamsUserMappingService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(TeamsApiClient) private readonly api: TeamsApiClient,
  ) {}

  async resolveMuninUser(input: {
    integration: IntegrationRow;
    creds: TeamsBotCredentials;
    serviceUrl: string;
    conversationId: string;
    sender: TeamsSender;
  }): Promise<string | null> {
    const { integration, sender } = input;
    const aadObjectId = sender.aadObjectId?.trim().toLowerCase();
    if (!aadObjectId) return null;

    const [existing] = await this.db
      .select({ userId: schema.teamsUserLinks.userId })
      .from(schema.teamsUserLinks)
      .where(
        and(
          eq(schema.teamsUserLinks.integrationId, integration.id),
          eq(schema.teamsUserLinks.aadObjectId, aadObjectId),
        ),
      )
      .limit(1);
    if (existing) {
      return (await isOrgMember(this.db, integration.orgId, existing.userId)) ? existing.userId : null;
    }

    let member;
    try {
      member = await this.api.getMember({
        creds: input.creds,
        serviceUrl: input.serviceUrl,
        conversationId: input.conversationId,
        memberId: sender.id,
      });
    } catch (err) {
      this.logger.warn(`teams member lookup failed for ${aadObjectId}: ${describeError(err)}`);
      return null;
    }
    const userId = await findOrgMemberByEmail(this.db, integration.orgId, [
      member.email,
      member.userPrincipalName,
    ]);
    if (!userId) return null;

    await this.db
      .insert(schema.teamsUserLinks)
      .values({ orgId: integration.orgId, integrationId: integration.id, aadObjectId, userId })
      .onConflictDoNothing();
    return userId;
  }
}
