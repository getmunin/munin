import { schema, type Db, type Tx } from '@getmunin/db';
import { and, eq, inArray } from 'drizzle-orm';

export async function reopenClosedConversation(
  tx: Db | Tx,
  conversationId: string,
): Promise<boolean> {
  const reopened = await tx
    .update(schema.convConversations)
    .set({ status: 'open', updatedAt: new Date() })
    .where(
      and(
        eq(schema.convConversations.id, conversationId),
        inArray(schema.convConversations.status, ['closed', 'snoozed']),
      ),
    )
    .returning({ id: schema.convConversations.id });
  return reopened.length > 0;
}
