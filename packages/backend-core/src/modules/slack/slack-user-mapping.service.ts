import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { schema, type Db } from '@getmunin/db';
import { describeError } from '@getmunin/core';
import { DB } from '../../common/db/db.module.ts';
import { SlackApiClient, type SlackUserInfo } from './slack-api.client.ts';

type IntegrationRow = typeof schema.slackIntegrations.$inferSelect;

export interface SlackActingUser {
  id: string;
  teamId?: string | null;
}

export function belongsToWorkspace(info: SlackUserInfo, teamId: string): boolean {
  if (info.isStranger || info.deleted || info.isBot) return false;
  return info.teamId === teamId || info.enterpriseTeamIds.includes(teamId);
}

export function eligibleForEmailLink(info: SlackUserInfo, teamId: string): boolean {
  if (!belongsToWorkspace(info, teamId)) return false;
  if (info.isRestricted || info.isUltraRestricted) return false;
  return typeof info.email === 'string' && info.email.trim().length > 0;
}

@Injectable()
export class SlackUserMappingService {
  private readonly logger = new Logger(SlackUserMappingService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(SlackApiClient) private readonly api: SlackApiClient,
  ) {}

  async resolveMuninUser(
    integration: IntegrationRow,
    slackUser: SlackActingUser,
    token: string,
  ): Promise<string | null> {
    const [existing] = await this.db
      .select({ userId: schema.slackUserLinks.userId })
      .from(schema.slackUserLinks)
      .where(
        and(
          eq(schema.slackUserLinks.integrationId, integration.id),
          eq(schema.slackUserLinks.slackUserId, slackUser.id),
        ),
      )
      .limit(1);
    if (existing) {
      if (!(await this.reportedInWorkspace(integration, slackUser, token))) return null;
      return (await this.isOrgMember(integration.orgId, existing.userId))
        ? existing.userId
        : null;
    }

    const info = await this.lookup(slackUser.id, token);
    if (!info || !eligibleForEmailLink(info, integration.teamId)) return null;

    const email = info.email!.trim().toLowerCase();
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
        slackUserId: slackUser.id,
        userId: member.userId,
      })
      .onConflictDoNothing();
    return member.userId;
  }

  private async reportedInWorkspace(
    integration: IntegrationRow,
    slackUser: SlackActingUser,
    token: string,
  ): Promise<boolean> {
    if (!slackUser.teamId || slackUser.teamId === integration.teamId) return true;
    const info = await this.lookup(slackUser.id, token);
    return info !== null && belongsToWorkspace(info, integration.teamId);
  }

  private async lookup(slackUserId: string, token: string): Promise<SlackUserInfo | null> {
    try {
      return await this.api.usersInfo({ token, user: slackUserId });
    } catch (err) {
      this.logger.warn(`users.info failed for ${slackUserId}: ${describeError(err)}`);
      return null;
    }
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
