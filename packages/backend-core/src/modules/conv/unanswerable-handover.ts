import { and, eq, sql } from 'drizzle-orm';
import { schema, type Db, type Tx } from '@getmunin/db';

export async function raiseAttentionWhenAgentIsOff(
  tx: Db | Tx,
  conversationId: string,
): Promise<boolean> {
  const rows = await tx
    .update(schema.convConversations)
    .set({
      needsHumanAttention: true,
      needsHumanAttentionAt: new Date(),
      handoverResolvedAt: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.convConversations.id, conversationId),
        eq(schema.convConversations.needsHumanAttention, false),
        eq(schema.convConversations.status, 'open'),
        sql`COALESCE(
          (SELECT t.agent_mode FROM conv_topics t WHERE t.id = ${schema.convConversations.topicId}),
          ${schema.convConversations.agentMode}
        ) = 'off'`,
      ),
    )
    .returning({ id: schema.convConversations.id });
  return rows.length > 0;
}
