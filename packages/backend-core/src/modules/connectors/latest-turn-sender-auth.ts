import { and, desc, eq, ne } from 'drizzle-orm';
import { schema, type Db, type Tx } from '@getmunin/db';
import { latestTurnSenderAuthBlock, type SenderAuthBlock } from './identity-provenance.ts';

const LATEST_TURN_LOOKBACK = 50;

export interface LatestTurnScope {
  orgId: string;
  endUserId?: string | null;
  conversationId?: string | null;
}

export async function readLatestTurnSenderAuthBlock(
  db: Db | Tx,
  actor: LatestTurnScope,
): Promise<SenderAuthBlock | null> {
  if (!actor.conversationId || !actor.endUserId) return null;
  const messages = await db
    .select({
      authorType: schema.convMessages.authorType,
      metadata: schema.convMessages.metadata,
    })
    .from(schema.convMessages)
    .innerJoin(
      schema.convConversations,
      eq(schema.convConversations.id, schema.convMessages.conversationId),
    )
    .where(
      and(
        eq(schema.convMessages.conversationId, actor.conversationId),
        eq(schema.convConversations.orgId, actor.orgId),
        eq(schema.convConversations.endUserId, actor.endUserId),
        eq(schema.convMessages.internal, false),
        ne(schema.convMessages.authorType, 'system'),
      ),
    )
    .orderBy(desc(schema.convMessages.createdAt), desc(schema.convMessages.ingestedAt))
    .limit(LATEST_TURN_LOOKBACK);
  return latestTurnSenderAuthBlock(messages);
}
