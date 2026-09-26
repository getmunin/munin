import { and, eq, sql } from 'drizzle-orm';
import { schema, type Db } from '@getmunin/db';
import { formatPhoneNumber } from '../../common/format-phone.ts';
import { conversationUrl } from './bridge-events.ts';
import {
  parseMessageAttachments,
  type AuthorKind,
  type ConversationSnapshot,
  type MessageSnapshot,
  type ParentState,
} from './bridge-snapshot.ts';

export interface BridgeConversationContext {
  conversation: typeof schema.convConversations.$inferSelect;
  snapshot: ConversationSnapshot;
}

export class BridgeConversationReader {
  constructor(private readonly db: Db) {}

  async loadConversation(conversationId: string): Promise<BridgeConversationContext | null> {
    const [conversation] = await this.db
      .select()
      .from(schema.convConversations)
      .where(eq(schema.convConversations.id, conversationId))
      .limit(1);
    if (!conversation) return null;

    const [channel] = await this.db
      .select({ type: schema.convChannels.type, name: schema.convChannels.name })
      .from(schema.convChannels)
      .where(eq(schema.convChannels.id, conversation.channelId))
      .limit(1);
    const contact = conversation.contactId
      ? (
          await this.db
            .select()
            .from(schema.convContacts)
            .where(eq(schema.convContacts.id, conversation.contactId))
            .limit(1)
        )[0]
      : undefined;
    const endUser = conversation.endUserId
      ? (
          await this.db
            .select({
              name: schema.endUsers.name,
              email: schema.endUsers.email,
              phone: schema.endUsers.phone,
            })
            .from(schema.endUsers)
            .where(eq(schema.endUsers.id, conversation.endUserId))
            .limit(1)
        )[0]
      : undefined;

    const phone = contact?.phone ?? endUser?.phone ?? null;
    const snapshot: ConversationSnapshot = {
      displayId: conversation.displayId,
      subject: conversation.subject,
      channelType: channel?.type ?? 'unknown',
      channelName: channel?.name ?? null,
      contactName: contact?.name ?? endUser?.name ?? null,
      contactEmail: contact?.email ?? endUser?.email ?? null,
      contactPhone: phone ? formatPhoneNumber(phone) : null,
      dashboardUrl: conversationUrl(conversation.orgId, conversation.id),
    };
    return { conversation, snapshot };
  }

  async messageSnapshot(
    message: typeof schema.convMessages.$inferSelect,
    context: BridgeConversationContext,
  ): Promise<MessageSnapshot> {
    const authorKind = message.authorType as AuthorKind;
    return {
      authorKind,
      authorName: await this.authorName(authorKind, message.authorId, context),
      internal: message.internal,
      body: message.body,
      noSpeech: message.metadata.voiceNoSpeech === true,
      attachments: parseMessageAttachments(message.attachments),
    };
  }

  async authorName(
    kind: AuthorKind,
    authorId: string,
    context: BridgeConversationContext,
  ): Promise<string | null> {
    if (kind === 'user') return await this.userName(authorId);
    if (kind === 'end_user') {
      const { contactName, contactEmail, contactPhone } = context.snapshot;
      return contactName ?? contactEmail ?? contactPhone ?? null;
    }
    if (kind === 'agent') {
      const [assistant] = await this.db
        .select({ name: schema.assistants.name })
        .from(schema.assistants)
        .where(eq(schema.assistants.orgId, context.conversation.orgId))
        .limit(1);
      return assistant?.name ?? null;
    }
    return null;
  }

  async userName(userId: string): Promise<string | null> {
    const [user] = await this.db
      .select({ name: schema.users.name, email: schema.users.email })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    return user?.name ?? user?.email ?? null;
  }

  async holderName(payload: Record<string, unknown>): Promise<string> {
    const holderType = typeof payload.holderType === 'string' ? payload.holderType : null;
    const holderId = typeof payload.holderId === 'string' ? payload.holderId : null;
    if (holderType === 'user' && holderId) {
      return (await this.userName(holderId)) ?? 'a teammate';
    }
    return 'a teammate';
  }

  async loadParentState(context: BridgeConversationContext): Promise<ParentState> {
    const conversation = context.conversation;
    const [claim] = await this.db
      .select({ userId: schema.claims.userId })
      .from(schema.claims)
      .where(
        and(
          eq(schema.claims.entityType, 'conversation'),
          eq(schema.claims.entityId, conversation.id),
          sql`${schema.claims.expiresAt} > now()`,
        ),
      )
      .orderBy(sql`${schema.claims.expiresAt} DESC`)
      .limit(1);
    let claimedBy: string | null = null;
    if (claim?.userId) claimedBy = (await this.userName(claim.userId)) ?? 'a teammate';

    const assignedTo = conversation.assigneeUserId
      ? await this.userName(conversation.assigneeUserId)
      : null;

    return {
      status: conversation.status,
      needsHumanAttention: conversation.needsHumanAttention,
      claimedBy,
      assignedTo,
    };
  }
}
