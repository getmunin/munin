import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { schema, type Tx } from '@getmunin/db';
import { and, asc, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { WebhookDispatcher, getCurrentContext, verifyHmac } from '@getmunin/core';
import { WidgetChannelConfig } from './widget.types.ts';
import type {
  WidgetConversationEnvelope,
  WidgetConversationSummary,
  WidgetIngestInputT,
  WidgetIngestResult,
  WidgetListConversationsQueryT,
  WidgetListConversationsResult,
  WidgetListMessagesQueryT,
  WidgetListMessagesResult,
  WidgetListedMessage,
  WidgetSetVisitorInputT,
  WidgetSetVisitorResult,
  WidgetStartConversationInputT,
  WidgetStartConversationResult,
} from './widget.types.ts';

const LIST_MESSAGES_LIMIT = 100;

export type IdentityResolution =
  | { mode: 'verified'; externalId: string }
  | { mode: 'anonymous' };

@Injectable()
export class WidgetIngestService {
  constructor(@Inject(WebhookDispatcher) private readonly webhooks: WebhookDispatcher) {}

  async ingest(
    orgId: string,
    input: WidgetIngestInputT,
    requestContext: { origin?: string } = {},
  ): Promise<WidgetIngestResult> {
    const ctx = getCurrentContext();
    await ctx.db.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`);
    return this.ingestInTx(ctx.db as Tx, orgId, input, requestContext);
  }

  async listMessages(
    orgId: string,
    query: WidgetListMessagesQueryT,
    requestContext: { origin?: string } = {},
  ): Promise<WidgetListMessagesResult> {
    const ctx = getCurrentContext();
    await ctx.db.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`);
    const tx = ctx.db as Tx;

    const channel = await this.loadChannel(tx, orgId, query.channelId);
    const channelConfig = WidgetChannelConfig.parse(channel.config);
    enforceOriginAllowlist(channelConfig, requestContext.origin);
    const identity = verifyIdentity(channelConfig, {
      verifiedExternalId: query.verifiedExternalId,
      userHash: query.userHash,
    });

    const conv = await tx
      .select({
        id: schema.convConversations.id,
        contactId: schema.convConversations.contactId,
        endUserId: schema.convConversations.endUserId,
        subject: schema.convConversations.subject,
        status: schema.convConversations.status,
        assigneeUserId: schema.convConversations.assigneeUserId,
      })
      .from(schema.convConversations)
      .where(
        and(
          eq(schema.convConversations.orgId, orgId),
          eq(schema.convConversations.channelId, channel.id),
          sql`${schema.convConversations.metadata}->>'sessionId' = ${query.sessionId}`,
        ),
      )
      .limit(1);
    if (!conv[0]) return { messages: [], hasMore: false, conversation: null };

    const contactRow = conv[0].contactId
      ? (
          await tx
            .select({
              email: schema.convContacts.email,
              metadata: schema.convContacts.metadata,
            })
            .from(schema.convContacts)
            .where(eq(schema.convContacts.id, conv[0].contactId))
            .limit(1)
        )[0]
      : null;

    if (identity.mode === 'verified') {
      const contactExternalId = (contactRow?.metadata as { externalId?: string } | undefined)
        ?.externalId;
      if (contactExternalId !== identity.externalId) {
        return { messages: [], hasMore: false, conversation: null };
      }
    }

    const sinceFilter = query.since
      ? gte(schema.convMessages.createdAt, new Date(query.since.getTime() + 1))
      : undefined;
    const rows = await tx
      .select({
        id: schema.convMessages.id,
        authorType: schema.convMessages.authorType,
        authorId: schema.convMessages.authorId,
        body: schema.convMessages.body,
        bodyHtml: schema.convMessages.bodyHtml,
        createdAt: schema.convMessages.createdAt,
        internal: schema.convMessages.internal,
      })
      .from(schema.convMessages)
      .where(
        sinceFilter
          ? and(eq(schema.convMessages.conversationId, conv[0].id), sinceFilter)
          : eq(schema.convMessages.conversationId, conv[0].id),
      )
      .orderBy(asc(schema.convMessages.createdAt))
      .limit(LIST_MESSAGES_LIMIT + 1);

    const hasMore = rows.length > LIST_MESSAGES_LIMIT;
    const slice = hasMore ? rows.slice(0, LIST_MESSAGES_LIMIT) : rows;
    const visible = slice.filter((r) => !r.internal);

    const userIdSet = new Set<string>(
      visible.filter((r) => r.authorType === 'user').map((r) => r.authorId),
    );
    if (conv[0].assigneeUserId) userIdSet.add(conv[0].assigneeUserId);
    const userNames =
      userIdSet.size > 0
        ? await this.loadUserNames(tx, Array.from(userIdSet))
        : new Map<string, string>();
    const assigneeName = conv[0].assigneeUserId
      ? firstWord(userNames.get(conv[0].assigneeUserId)) ?? null
      : null;

    const hasAgentMessage = visible.some((r) => r.authorType === 'agent');
    const assistantName = hasAgentMessage ? await this.loadAssistantName(tx, orgId) : null;
    const agentDisplayName = assistantName ?? 'Munin';

    const readableIds = visible
      .filter((r) => r.authorType !== 'end_user')
      .map((r) => r.id);
    const readsByMessageId =
      conv[0].endUserId && readableIds.length > 0
        ? await this.loadReadsForEndUser(tx, readableIds, conv[0].endUserId)
        : new Map<string, Date>();

    const messages: WidgetListedMessage[] = visible.map((r) => ({
      id: r.id,
      role: normalizeRole(r.authorType),
      authorKind: authorKindFor(r.authorType),
      authorName:
        r.authorType === 'user'
          ? firstWord(userNames.get(r.authorId)) ?? null
          : r.authorType === 'agent'
            ? agentDisplayName
            : null,
      body: r.body,
      bodyHtml: r.bodyHtml,
      at: r.createdAt.toISOString(),
      readAt: readsByMessageId.get(r.id)?.toISOString() ?? null,
    }));

    const envelope: WidgetConversationEnvelope = {
      id: conv[0].id,
      subject: conv[0].subject,
      status: conv[0].status,
      handedOver: !!conv[0].assigneeUserId,
      assigneeName,
      contactEmail: contactRow?.email ?? null,
    };

    return { messages, hasMore, conversation: envelope };
  }

  async listConversations(
    orgId: string,
    query: WidgetListConversationsQueryT,
    requestContext: { origin?: string } = {},
  ): Promise<WidgetListConversationsResult> {
    const ctx = getCurrentContext();
    await ctx.db.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`);
    const tx = ctx.db as Tx;

    const channel = await this.loadChannel(tx, orgId, query.channelId);
    const channelConfig = WidgetChannelConfig.parse(channel.config);
    enforceOriginAllowlist(channelConfig, requestContext.origin);
    const identity = verifyIdentity(channelConfig, {
      verifiedExternalId: query.verifiedExternalId,
      userHash: query.userHash,
    });

    let convRows: Array<{
      id: string;
      subject: string | null;
      status: string;
      assigneeUserId: string | null;
      lastMessageAt: Date | null;
      sessionId: string | null;
    }> = [];

    if (identity.mode === 'verified') {
      convRows = await tx
        .select({
          id: schema.convConversations.id,
          subject: schema.convConversations.subject,
          status: schema.convConversations.status,
          assigneeUserId: schema.convConversations.assigneeUserId,
          lastMessageAt: schema.convConversations.lastMessageAt,
          sessionId: sql<
            string | null
          >`${schema.convConversations.metadata}->>'sessionId'`.as('session_id'),
        })
        .from(schema.convConversations)
        .innerJoin(
          schema.convContacts,
          eq(schema.convConversations.contactId, schema.convContacts.id),
        )
        .where(
          and(
            eq(schema.convConversations.orgId, orgId),
            eq(schema.convConversations.channelId, channel.id),
            sql`${schema.convContacts.metadata}->>'externalId' = ${identity.externalId}`,
          ),
        )
        .orderBy(desc(schema.convConversations.lastMessageAt))
        .limit(20);
    } else if (query.sessionIds.length > 0) {
      convRows = await tx
        .select({
          id: schema.convConversations.id,
          subject: schema.convConversations.subject,
          status: schema.convConversations.status,
          assigneeUserId: schema.convConversations.assigneeUserId,
          lastMessageAt: schema.convConversations.lastMessageAt,
          sessionId: sql<
            string | null
          >`${schema.convConversations.metadata}->>'sessionId'`.as('session_id'),
        })
        .from(schema.convConversations)
        .where(
          and(
            eq(schema.convConversations.orgId, orgId),
            eq(schema.convConversations.channelId, channel.id),
            inArray(
              sql<string>`${schema.convConversations.metadata}->>'sessionId'`,
              query.sessionIds,
            ),
          ),
        )
        .orderBy(desc(schema.convConversations.lastMessageAt))
        .limit(20);
    } else {
      return { conversations: [] };
    }

    const convIds = convRows.map((r) => r.id);
    const previews =
      convIds.length > 0
        ? await this.loadLatestVisiblePreviews(tx, convIds)
        : new Map<string, { lastBody: string; firstUserBody: string | null }>();

    const summaries: WidgetConversationSummary[] = convRows
      .filter((r) => !!r.sessionId)
      .map((r) => {
        const preview = previews.get(r.id);
        return {
          id: r.id,
          sessionId: r.sessionId!,
          title: r.subject ?? preview?.firstUserBody ?? 'Conversation',
          preview: preview?.lastBody ?? '',
          status: r.status,
          handedOver: !!r.assigneeUserId,
          lastMessageAt: r.lastMessageAt ? r.lastMessageAt.toISOString() : null,
        };
      });

    return { conversations: summaries };
  }

  async setVisitor(
    orgId: string,
    input: WidgetSetVisitorInputT,
    requestContext: { origin?: string } = {},
  ): Promise<WidgetSetVisitorResult> {
    const ctx = getCurrentContext();
    await ctx.db.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`);
    const tx = ctx.db as Tx;

    const channel = await this.loadChannel(tx, orgId, input.channelId);
    const channelConfig = WidgetChannelConfig.parse(channel.config);
    enforceOriginAllowlist(channelConfig, requestContext.origin);
    const identity = verifyIdentity(channelConfig, {
      verifiedExternalId: input.verifiedExternalId,
      userHash: input.userHash,
    });

    const conv = await tx
      .select({
        id: schema.convConversations.id,
        contactId: schema.convConversations.contactId,
      })
      .from(schema.convConversations)
      .where(
        and(
          eq(schema.convConversations.orgId, orgId),
          eq(schema.convConversations.channelId, channel.id),
          sql`${schema.convConversations.metadata}->>'sessionId' = ${input.sessionId}`,
        ),
      )
      .limit(1);
    if (!conv[0] || !conv[0].contactId) {
      throw new NotFoundException('session_not_found');
    }
    const contactId = conv[0].contactId;

    if (identity.mode === 'verified') {
      const contact = await tx
        .select({ metadata: schema.convContacts.metadata })
        .from(schema.convContacts)
        .where(eq(schema.convContacts.id, contactId))
        .limit(1);
      const contactExternalId = (contact[0]?.metadata as { externalId?: string } | undefined)
        ?.externalId;
      if (contactExternalId !== identity.externalId) {
        throw new ForbiddenException('session_not_owned');
      }
    }

    const patch: Record<string, unknown> = {};
    if (input.email) patch.email = input.email.trim().toLowerCase();
    if (input.name) patch.name = input.name.trim();
    if (Object.keys(patch).length === 0) {
      const current = await tx
        .select({ email: schema.convContacts.email, name: schema.convContacts.name })
        .from(schema.convContacts)
        .where(eq(schema.convContacts.id, contactId))
        .limit(1);
      return {
        contactId,
        email: current[0]?.email ?? null,
        name: current[0]?.name ?? null,
      };
    }

    const updated = await tx
      .update(schema.convContacts)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(schema.convContacts.id, contactId))
      .returning({
        id: schema.convContacts.id,
        email: schema.convContacts.email,
        name: schema.convContacts.name,
        endUserId: schema.convContacts.endUserId,
      });

    const endUserId = updated[0]!.endUserId;
    if (endUserId) {
      await tx
        .update(schema.endUsers)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(schema.endUsers.id, endUserId));
    }

    return {
      contactId: updated[0]!.id,
      email: updated[0]!.email ?? null,
      name: updated[0]!.name ?? null,
    };
  }

  async startConversation(
    orgId: string,
    input: WidgetStartConversationInputT,
    requestContext: { origin?: string } = {},
  ): Promise<WidgetStartConversationResult> {
    const ctx = getCurrentContext();
    await ctx.db.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`);
    const tx = ctx.db as Tx;

    const channel = await this.loadChannel(tx, orgId, input.channelId);
    const channelConfig = WidgetChannelConfig.parse(channel.config);
    enforceOriginAllowlist(channelConfig, requestContext.origin);
    const identity = verifyIdentity(channelConfig, {
      verifiedExternalId: input.verifiedExternalId,
      userHash: input.userHash,
    });

    const ingestShape: WidgetIngestInputT = {
      channelId: input.channelId,
      sessionId: input.sessionId,
      visitorId: input.visitorId,
      verifiedExternalId: input.verifiedExternalId,
      userHash: input.userHash,
      visitor: input.visitor,
      url: input.url,
      locale: input.locale,
      messages: [],
    };

    const endUser = await this.findOrCreateEndUser(tx, orgId, ingestShape, identity);
    const contact = await this.findOrCreateContact(tx, orgId, ingestShape, identity, endUser.id);

    const existing = await tx
      .select({
        id: schema.convConversations.id,
        displayId: schema.convConversations.displayId,
        metadata: schema.convConversations.metadata,
      })
      .from(schema.convConversations)
      .where(
        and(
          eq(schema.convConversations.orgId, orgId),
          eq(schema.convConversations.channelId, channel.id),
          sql`${schema.convConversations.metadata}->>'sessionId' = ${input.sessionId}`,
        ),
      )
      .limit(1);

    if (existing[0]) {
      return {
        conversationId: existing[0].id,
        displayId: existing[0].displayId,
        contactId: contact.id,
      };
    }

    const next = await tx.execute<{ next: number } & Record<string, unknown>>(
      sql`SELECT conv_next_display_id(${orgId}) AS next`,
    );
    const displayId = next[0]!.next;
    const meta: Record<string, unknown> = { sessionId: input.sessionId, pendingGreeting: true };
    if (input.url) meta.url = input.url;
    const [created] = await tx
      .insert(schema.convConversations)
      .values({
        orgId,
        displayId,
        channelId: channel.id,
        contactId: contact.id,
        endUserId: endUser.id,
        status: 'open',
        metadata: meta,
        lastMessageAt: new Date(),
      })
      .returning({
        id: schema.convConversations.id,
        displayId: schema.convConversations.displayId,
      });

    await this.webhooks.emit({
      type: 'conversation.created',
      payload: { conversationId: created!.id, displayId: created!.displayId, channelId: channel.id },
    });
    await this.webhooks.emit({
      type: 'conversation.greet_requested',
      payload: {
        conversationId: created!.id,
        endUserId: endUser.id,
        channelId: channel.id,
      },
    });

    return {
      conversationId: created!.id,
      displayId: created!.displayId,
      contactId: contact.id,
    };
  }

  private async loadAssistantName(tx: Tx, orgId: string): Promise<string | null> {
    const [row] = await tx
      .select({ name: schema.assistants.name })
      .from(schema.assistants)
      .where(eq(schema.assistants.orgId, orgId))
      .limit(1);
    return row?.name?.trim() || null;
  }

  private async loadReadsForEndUser(
    tx: Tx,
    messageIds: string[],
    endUserId: string,
  ): Promise<Map<string, Date>> {
    if (messageIds.length === 0) return new Map();
    const rows = await tx
      .select({
        messageId: schema.convMessageReads.messageId,
        readAt: schema.convMessageReads.readAt,
      })
      .from(schema.convMessageReads)
      .where(
        and(
          eq(schema.convMessageReads.endUserId, endUserId),
          inArray(schema.convMessageReads.messageId, messageIds),
        ),
      );
    const out = new Map<string, Date>();
    for (const r of rows) {
      out.set(r.messageId, r.readAt instanceof Date ? r.readAt : new Date(r.readAt));
    }
    return out;
  }

  private async loadUserNames(tx: Tx, userIds: string[]): Promise<Map<string, string>> {
    if (userIds.length === 0) return new Map();
    const rows = await tx
      .select({ id: schema.users.id, name: schema.users.name, email: schema.users.email })
      .from(schema.users)
      .where(inArray(schema.users.id, userIds));
    const out = new Map<string, string>();
    for (const r of rows) {
      const display = r.name?.trim() || r.email.split('@')[0] || 'Agent';
      out.set(r.id, display);
    }
    return out;
  }

  private async loadLatestVisiblePreviews(
    tx: Tx,
    conversationIds: string[],
  ): Promise<Map<string, { lastBody: string; firstUserBody: string | null }>> {
    if (conversationIds.length === 0) return new Map();
    const rows = await tx
      .select({
        conversationId: schema.convMessages.conversationId,
        body: schema.convMessages.body,
        authorType: schema.convMessages.authorType,
        createdAt: schema.convMessages.createdAt,
      })
      .from(schema.convMessages)
      .where(
        and(
          inArray(schema.convMessages.conversationId, conversationIds),
          eq(schema.convMessages.internal, false),
        ),
      )
      .orderBy(asc(schema.convMessages.createdAt));

    const out = new Map<string, { lastBody: string; firstUserBody: string | null }>();
    for (const r of rows) {
      const cur = out.get(r.conversationId) ?? { lastBody: '', firstUserBody: null as string | null };
      cur.lastBody = singleLinePreview(r.body);
      if (cur.firstUserBody === null && r.authorType === 'end_user') {
        cur.firstUserBody = singleLinePreview(r.body);
      }
      out.set(r.conversationId, cur);
    }
    return out;
  }

  private async ingestInTx(
    tx: Tx,
    orgId: string,
    input: WidgetIngestInputT,
    requestContext: { origin?: string },
  ): Promise<WidgetIngestResult> {
    const channel = await this.loadChannel(tx, orgId, input.channelId);
    const channelConfig = WidgetChannelConfig.parse(channel.config);
    enforceOriginAllowlist(channelConfig, requestContext.origin);
    const identity = verifyIdentity(channelConfig, {
      verifiedExternalId: input.verifiedExternalId,
      userHash: input.userHash,
    });
    const endUser = await this.findOrCreateEndUser(tx, orgId, input, identity);
    const contact = await this.findOrCreateContact(tx, orgId, input, identity, endUser.id);

    const conv = await this.findOrCreateConversation(
      tx,
      orgId,
      channel.id,
      contact.id,
      endUser.id,
      input,
    );

    let inserted = 0;
    let skipped = 0;
    const events: Array<{ messageId: string; authorType: string }> = [];
    for (const msg of input.messages) {
      const meta: Record<string, unknown> = { sessionId: input.sessionId };
      if (msg.providerMessageId) meta.providerMessageId = msg.providerMessageId;
      if (msg.inReplyTo) meta.inReplyTo = msg.inReplyTo;
      if (input.url) meta.url = input.url;
      if (input.providerThreadId) meta.providerThreadId = input.providerThreadId;

      const authorType = 'end_user';
      const authorId = contact.id;

      let insertedId: string | null = null;
      let dup = false;
      try {
        await tx.transaction(async (sp) => {
          const inserts = await sp
            .insert(schema.convMessages)
            .values({
              orgId,
              conversationId: conv.id,
              authorType,
              authorId,
              body: msg.body,
              bodyHtml: msg.bodyHtml ?? null,
              internal: false,
              metadata: meta,
              createdAt: msg.at ?? undefined,
            })
            .returning({ id: schema.convMessages.id });
          insertedId = inserts[0]!.id;
        });
      } catch (err) {
        if (isUniqueViolation(err)) {
          dup = true;
        } else {
          throw err;
        }
      }
      if (dup) {
        skipped += 1;
        continue;
      }
      events.push({ messageId: insertedId!, authorType });
      inserted += 1;
    }

    if (inserted > 0) {
      await tx
        .update(schema.convConversations)
        .set({ lastMessageAt: new Date(), updatedAt: new Date() })
        .where(eq(schema.convConversations.id, conv.id));

      const hasVisitorMessage = events.some((e) => e.authorType === 'end_user');
      if (hasVisitorMessage) {
        const reopened = await tx
          .update(schema.convConversations)
          .set({ status: 'open', updatedAt: new Date() })
          .where(
            and(
              eq(schema.convConversations.id, conv.id),
              inArray(schema.convConversations.status, ['closed', 'snoozed']),
            ),
          )
          .returning({ id: schema.convConversations.id });
        if (reopened[0]) {
          await this.webhooks.emit({
            type: 'conversation.status_changed',
            payload: { conversationId: conv.id, status: 'open' },
          });
        }
      }
    }

    for (const ev of events) {
      const type =
        ev.authorType === 'end_user'
          ? 'conversation.message.received'
          : 'conversation.message.sent';
      await this.webhooks.emit({
        type,
        payload: {
          conversationId: conv.id,
          messageId: ev.messageId,
          authorType: ev.authorType,
          internal: false,
        },
      });
    }

    return {
      conversationId: conv.id,
      displayId: conv.displayId,
      contactId: contact.id,
      inserted,
      skipped,
    };
  }

  private async loadChannel(
    tx: Tx,
    orgId: string,
    channelId: string,
  ): Promise<typeof schema.convChannels.$inferSelect> {
    return loadWidgetChannel(tx, orgId, channelId);
  }

  private async findOrCreateEndUser(
    tx: Tx,
    orgId: string,
    input: WidgetIngestInputT,
    identity: IdentityResolution,
  ): Promise<typeof schema.endUsers.$inferSelect> {
    const anonKey = input.visitorId ?? input.sessionId;
    const externalId =
      identity.mode === 'verified' ? identity.externalId : `anon:${anonKey}`;
    const existing = await tx
      .select()
      .from(schema.endUsers)
      .where(and(eq(schema.endUsers.orgId, orgId), eq(schema.endUsers.externalId, externalId)))
      .limit(1);
    if (existing[0]) {
      const currentLocale = (existing[0].metadata as { locale?: string } | null)?.locale ?? null;
      if (input.locale && currentLocale !== input.locale) {
        const [updated] = await tx
          .update(schema.endUsers)
          .set({
            metadata: sql`COALESCE(${schema.endUsers.metadata}, '{}'::jsonb) || ${JSON.stringify({ locale: input.locale })}::jsonb`,
          })
          .where(eq(schema.endUsers.id, existing[0].id))
          .returning();
        return updated!;
      }
      return existing[0];
    }
    const baseMetadata: Record<string, unknown> =
      identity.mode === 'verified'
        ? {}
        : {
            anonymous: true,
            sessionId: input.sessionId,
            ...(input.visitorId ? { visitorId: input.visitorId } : {}),
          };
    if (input.locale) baseMetadata.locale = input.locale;
    const [created] = await tx
      .insert(schema.endUsers)
      .values({
        orgId,
        externalId,
        email: input.visitor?.email?.trim().toLowerCase() ?? null,
        name: input.visitor?.name ?? null,
        metadata: baseMetadata,
      })
      .returning();
    return created!;
  }

  private async findOrCreateContact(
    tx: Tx,
    orgId: string,
    input: WidgetIngestInputT,
    identity: IdentityResolution,
    endUserId: string,
  ): Promise<typeof schema.convContacts.$inferSelect> {
    if (identity.mode === 'verified') {
      const verifiedRows = await tx
        .select()
        .from(schema.convContacts)
        .where(
          and(
            eq(schema.convContacts.orgId, orgId),
            sql`${schema.convContacts.metadata}->>'externalId' = ${identity.externalId}`,
          ),
        )
        .limit(1);
      if (verifiedRows[0]) {
        const patch: Record<string, unknown> = {};
        if (input.visitor?.name && !verifiedRows[0].name) patch.name = input.visitor.name;
        if (!verifiedRows[0].endUserId) patch.endUserId = endUserId;
        if (Object.keys(patch).length > 0) {
          await tx
            .update(schema.convContacts)
            .set({ ...patch, updatedAt: new Date() })
            .where(eq(schema.convContacts.id, verifiedRows[0].id));
        }
        return verifiedRows[0];
      }
      const lowerEmailV = input.visitor?.email?.trim().toLowerCase();
      const [created] = await tx
        .insert(schema.convContacts)
        .values({
          orgId,
          endUserId,
          email: lowerEmailV ?? null,
          name: input.visitor?.name ?? null,
          metadata: {
            sessionId: input.sessionId,
            externalId: identity.externalId,
            ...(input.visitor?.metadata ?? {}),
          },
        })
        .returning();
      return created!;
    }

    const lowerEmail = input.visitor?.email?.trim().toLowerCase();
    if (lowerEmail) {
      const existing = await tx
        .select()
        .from(schema.convContacts)
        .where(and(eq(schema.convContacts.orgId, orgId), eq(schema.convContacts.email, lowerEmail)))
        .limit(1);
      if (existing[0]) {
        const patch: Record<string, unknown> = {};
        if (input.visitor?.name && !existing[0].name) patch.name = input.visitor.name;
        if (!existing[0].endUserId) patch.endUserId = endUserId;
        if (Object.keys(patch).length > 0) {
          await tx
            .update(schema.convContacts)
            .set({ ...patch, updatedAt: new Date() })
            .where(eq(schema.convContacts.id, existing[0].id));
        }
        return existing[0];
      }
    }
    const sessionRows = await tx
      .select()
      .from(schema.convContacts)
      .where(
        and(
          eq(schema.convContacts.orgId, orgId),
          sql`${schema.convContacts.metadata}->>'sessionId' = ${input.sessionId}`,
        ),
      )
      .limit(1);
    if (sessionRows[0]) {
      if (!sessionRows[0].endUserId) {
        await tx
          .update(schema.convContacts)
          .set({ endUserId, updatedAt: new Date() })
          .where(eq(schema.convContacts.id, sessionRows[0].id));
      }
      return sessionRows[0];
    }

    const [created] = await tx
      .insert(schema.convContacts)
      .values({
        orgId,
        endUserId,
        email: lowerEmail ?? null,
        name: input.visitor?.name ?? null,
        metadata: { sessionId: input.sessionId, ...(input.visitor?.metadata ?? {}) },
      })
      .returning();
    return created!;
  }

  private async findOrCreateConversation(
    tx: Tx,
    orgId: string,
    channelId: string,
    contactId: string,
    endUserId: string,
    input: WidgetIngestInputT,
  ): Promise<{ id: string; displayId: number }> {
    const existing = await tx
      .select({ id: schema.convConversations.id, displayId: schema.convConversations.displayId, endUserId: schema.convConversations.endUserId })
      .from(schema.convConversations)
      .where(
        and(
          eq(schema.convConversations.orgId, orgId),
          eq(schema.convConversations.channelId, channelId),
          sql`${schema.convConversations.metadata}->>'sessionId' = ${input.sessionId}`,
        ),
      )
      .limit(1);
    if (existing[0]) {
      if (!existing[0].endUserId) {
        await tx
          .update(schema.convConversations)
          .set({ endUserId, updatedAt: new Date() })
          .where(eq(schema.convConversations.id, existing[0].id));
      }
      return { id: existing[0].id, displayId: existing[0].displayId };
    }

    const next = await tx.execute<{ next: number } & Record<string, unknown>>(
      sql`SELECT conv_next_display_id(${orgId}) AS next`,
    );
    const displayId = next[0]!.next;
    const [created] = await tx
      .insert(schema.convConversations)
      .values({
        orgId,
        displayId,
        channelId,
        contactId,
        endUserId,
        status: 'open',
        metadata: { sessionId: input.sessionId, ...(input.providerThreadId ? { providerThreadId: input.providerThreadId } : {}) },
        lastMessageAt: new Date(),
      })
      .returning({
        id: schema.convConversations.id,
        displayId: schema.convConversations.displayId,
      });

    await this.webhooks.emit({
      type: 'conversation.created',
      payload: { conversationId: created!.id, displayId: created!.displayId, channelId },
    });
    return created!;
  }
}

function firstWord(name: string | null | undefined): string | null {
  const trimmed = name?.trim();
  if (!trimmed) return null;
  return trimmed.split(/\s+/)[0]!;
}

function normalizeRole(authorType: string): WidgetListedMessage['role'] {
  if (authorType === 'end_user') return 'end_user';
  if (authorType === 'agent' || authorType === 'user') return 'agent';
  return 'system';
}

function authorKindFor(authorType: string): WidgetListedMessage['authorKind'] {
  if (authorType === 'user') return 'human';
  if (authorType === 'agent') return 'ai';
  return null;
}

function singleLinePreview(body: string): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  return flat.length > 140 ? flat.slice(0, 139).trimEnd() + '…' : flat;
}

function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const direct = (err as { code?: unknown }).code;
  if (direct === '23505') return true;
  const cause = (err as { cause?: unknown }).cause;
  if (cause && typeof cause === 'object' && (cause as { code?: unknown }).code === '23505') {
    return true;
  }
  return false;
}

export function enforceOriginAllowlist(
  channelConfig: { originAllowlist: string[] },
  origin: string | undefined,
): void {
  const list = channelConfig.originAllowlist ?? [];
  if (list.length === 0) {
    if (requireWidgetAllowlist()) {
      throw new ForbiddenException('origin_allowlist_required');
    }
    return;
  }
  if (!origin) throw new ForbiddenException('origin_required');
  const allowed = list.some((entry) => originMatches(entry, origin));
  if (!allowed) throw new ForbiddenException('origin_not_allowed');
}

function requireWidgetAllowlist(): boolean {
  const raw = process.env.MUNIN_WIDGET_REQUIRE_ALLOWLIST?.trim().toLowerCase();
  return raw === '1' || raw === 'true';
}

export async function loadWidgetChannel(
  tx: Tx,
  orgId: string,
  channelId: string,
): Promise<typeof schema.convChannels.$inferSelect> {
  const rows = await tx
    .select()
    .from(schema.convChannels)
    .where(and(eq(schema.convChannels.id, channelId), eq(schema.convChannels.orgId, orgId)))
    .limit(1);
  const channel = rows[0];
  if (!channel) throw new NotFoundException(`channel ${channelId} not found`);
  if (channel.type !== 'chat') {
    throw new BadRequestException(`channel ${channelId} is not a chat channel`);
  }
  if (!channel.active) {
    throw new ForbiddenException(`channel ${channelId} is inactive`);
  }
  const parsed = WidgetChannelConfig.safeParse(channel.config);
  if (!parsed.success) {
    throw new BadRequestException(`channel ${channelId} is not configured as a widget channel`);
  }
  return channel;
}

function originMatches(allowlistEntry: string, origin: string): boolean {
  try {
    const a = new URL(allowlistEntry).origin;
    const b = new URL(origin).origin;
    return a === b;
  } catch {
    return false;
  }
}

export function verifyIdentity(
  channelConfig: { identityVerificationSecret?: string; requireVerifiedIdentity: boolean },
  input: { verifiedExternalId?: string; userHash?: string },
): IdentityResolution {
  const hasExt = !!input.verifiedExternalId;
  const hasHash = !!input.userHash;

  if (hasExt !== hasHash) {
    throw new ForbiddenException('identity_partial');
  }

  if (hasExt && hasHash) {
    if (!channelConfig.identityVerificationSecret) {
      throw new ForbiddenException('identity_verification_failed');
    }
    const ok = verifyHmac(
      input.verifiedExternalId!,
      channelConfig.identityVerificationSecret,
      input.userHash!.toLowerCase(),
    );
    if (!ok) throw new ForbiddenException('identity_verification_failed');
    return { mode: 'verified', externalId: input.verifiedExternalId! };
  }

  if (channelConfig.requireVerifiedIdentity) {
    throw new ForbiddenException('identity_required');
  }
  return { mode: 'anonymous' };
}
