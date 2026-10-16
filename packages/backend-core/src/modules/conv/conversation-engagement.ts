import { schema, type Db, type Tx } from '@getmunin/db';
import { and, eq } from 'drizzle-orm';

export async function markConversationEngaged(
  tx: Db | Tx,
  conversationId: string,
): Promise<boolean> {
  const engaged = await tx
    .update(schema.convConversations)
    .set({ unengaged: false, updatedAt: new Date() })
    .where(
      and(
        eq(schema.convConversations.id, conversationId),
        eq(schema.convConversations.unengaged, true),
      ),
    )
    .returning({ id: schema.convConversations.id });
  return engaged.length > 0;
}
