import { and, eq, inArray, ne } from 'drizzle-orm';
import { schema, type Db } from '@getmunin/db';

export interface SharedChannelIntegration {
  orgId: string;
  teamId: string;
}

export async function isChannelShared(
  db: Db,
  integration: SharedChannelIntegration,
  slackChannelId: string,
): Promise<boolean> {
  const [other] = await db
    .select({ id: schema.slackChannelRoutes.id })
    .from(schema.slackChannelRoutes)
    .innerJoin(
      schema.slackIntegrations,
      eq(schema.slackIntegrations.id, schema.slackChannelRoutes.integrationId),
    )
    .where(
      and(
        eq(schema.slackChannelRoutes.teamId, integration.teamId),
        eq(schema.slackChannelRoutes.slackChannelId, slackChannelId),
        ne(schema.slackChannelRoutes.orgId, integration.orgId),
        eq(schema.slackIntegrations.active, true),
      ),
    )
    .limit(1);
  return other !== undefined;
}

export async function orgName(db: Db, orgId: string): Promise<string | null> {
  const [org] = await db
    .select({ name: schema.orgs.name })
    .from(schema.orgs)
    .where(eq(schema.orgs.id, orgId))
    .limit(1);
  return org?.name ?? null;
}

export async function sharedChannelOrgName(
  db: Db,
  integration: SharedChannelIntegration,
  slackChannelId: string,
): Promise<string | null> {
  if (!(await isChannelShared(db, integration, slackChannelId))) return null;
  return await orgName(db, integration.orgId);
}

export async function sharedChannelIds(
  db: Db,
  integration: SharedChannelIntegration,
  slackChannelIds: string[],
): Promise<Set<string>> {
  if (slackChannelIds.length === 0) return new Set();
  const rows = await db
    .selectDistinct({ slackChannelId: schema.slackChannelRoutes.slackChannelId })
    .from(schema.slackChannelRoutes)
    .innerJoin(
      schema.slackIntegrations,
      eq(schema.slackIntegrations.id, schema.slackChannelRoutes.integrationId),
    )
    .where(
      and(
        eq(schema.slackChannelRoutes.teamId, integration.teamId),
        inArray(schema.slackChannelRoutes.slackChannelId, slackChannelIds),
        ne(schema.slackChannelRoutes.orgId, integration.orgId),
        eq(schema.slackIntegrations.active, true),
      ),
    );
  return new Set(rows.map((row) => row.slackChannelId));
}
