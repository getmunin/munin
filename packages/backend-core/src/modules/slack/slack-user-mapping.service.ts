import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { schema, type Db } from '@getmunin/db';
import { describeError } from '@getmunin/core';
import { DB } from '../../common/db/db.module.ts';
import { SlackApiClient } from './slack-api.client.ts';

type IntegrationRow = typeof schema.slackIntegrations.$inferSelect;

/**
 * Slack user → Munin org member resolution, shared by thread replies and
 * button clicks. slack_user_links is the cache; a hit is still re-checked
 * against current org membership so removed members lose access
 * immediately. On miss, auto-map via the Slack profile email ↔ org member
 * email. Returns null for anyone unmappable — callers reject, never guess.
 */
@Injectable()
export class SlackUserMappingService {
  private readonly logger = new Logger(SlackUserMappingService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(SlackApiClient) private readonly api: SlackApiClient,
  ) {}

  async resolveMuninUser(
    integration: IntegrationRow,
    slackUserId: string,
    token: string,
  ): Promise<string | null> {
    const [existing] = await this.db
      .select({ userId: schema.slackUserLinks.userId })
      .from(schema.slackUserLinks)
      .where(
        and(
          eq(schema.slackUserLinks.integrationId, integration.id),
          eq(schema.slackUserLinks.slackUserId, slackUserId),
        ),
      )
      .limit(1);
    if (existing) {
      return (await this.isOrgMember(integration.orgId, existing.userId))
        ? existing.userId
        : null;
    }

    let info;
    try {
      info = await this.api.usersInfo({ token, user: slackUserId });
    } catch (err) {
      this.logger.warn(`users.info failed for ${slackUserId}: ${describeError(err)}`);
      return null;
    }
    if (info.isBot || !info.email) return null;

    const email = info.email.trim().toLowerCase();
    const [member] = await this.db
      .select({ userId: schema.users.id })
      .from(schema.users)
      .innerJoin(schema.orgMembers, eq(schema.orgMembers.userId, schema.users.id))
      .where(
        and(
          eq(schema.orgMembers.orgId, integration.orgId),
          sql`lower(${schema.users.email}) = ${email}`,
        ),
      )
      .limit(1);
    if (!member) return null;

    await this.db
      .insert(schema.slackUserLinks)
      .values({
        orgId: integration.orgId,
        integrationId: integration.id,
        slackUserId,
        userId: member.userId,
      })
      .onConflictDoNothing();
    return member.userId;
  }

  private async isOrgMember(orgId: string, userId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ userId: schema.orgMembers.userId })
      .from(schema.orgMembers)
      .where(and(eq(schema.orgMembers.orgId, orgId), eq(schema.orgMembers.userId, userId)))
      .limit(1);
    return row !== undefined;
  }
}
