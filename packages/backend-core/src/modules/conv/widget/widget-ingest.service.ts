import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { schema, type Tx } from '@getmunin/db';
import { and, eq, sql } from 'drizzle-orm';
import { WebhookDispatcher, getCurrentContext } from '@getmunin/core';
import { WidgetChannelConfig } from './widget.types.js';
import type { WidgetIngestInputT, WidgetIngestResult } from './widget.types.js';

/**
 * Idempotent ingestion of one widget batch into conv_*. Called from the
 * WidgetController inside the request's tenancy transaction; reuses
 * `ctx.db` so the org_id GUC the interceptor set is honored. Inside the
 * function body we briefly flip `app.bypass_rls=on` because we touch
 * conv_contacts / conv_conversations / conv_messages and need to write
 * across the org boundary as the bound widget key.
 */
@Injectable()
export class WidgetIngestService {
  constructor(@Inject(WebhookDispatcher) private readonly webhooks: WebhookDispatcher) {}

  async ingest(orgId: string, input: WidgetIngestInputT): Promise<WidgetIngestResult> {
    const ctx = getCurrentContext();
    // Local-to-tx bypass; we already inside the request transaction and just
    // need to open up writes to conv_* against the bound channel's org.
    await ctx.db.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`);
    return this.ingestInTx(ctx.db as Tx, orgId, input);
  }

  private async ingestInTx(
    tx: Tx,
    orgId: string,
    input: WidgetIngestInputT,
  ): Promise<WidgetIngestResult> {
    const channel = await this.loadChannel(tx, orgId, input.channelId);
    const contact = await this.findOrCreateContact(tx, orgId, input);

    const conv = await this.findOrCreateConversation(tx, orgId, channel.id, contact.id, input);

    let inserted = 0;
    let skipped = 0;
    const events: Array<{ messageId: string; authorType: string }> = [];
    for (const msg of input.messages) {
      const meta: Record<string, unknown> = { sessionId: input.sessionId };
      if (msg.providerMessageId) meta.providerMessageId = msg.providerMessageId;
      if (msg.inReplyTo) meta.inReplyTo = msg.inReplyTo;
      if (input.url) meta.url = input.url;
      if (input.providerThreadId) meta.providerThreadId = input.providerThreadId;

      const authorType = msg.role;
      const authorId = authorType === 'end_user' ? contact.id : 'widget-agent';

      // Wrap each insert in a savepoint so a duplicate-providerMessageId
      // unique violation rolls back only this message, not the outer tx.
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

  private async findOrCreateContact(
    tx: Tx,
    orgId: string,
    input: WidgetIngestInputT,
  ): Promise<typeof schema.convContacts.$inferSelect> {
    const lowerEmail = input.visitor?.email?.trim().toLowerCase();
    if (lowerEmail) {
      const existing = await tx
        .select()
        .from(schema.convContacts)
        .where(and(eq(schema.convContacts.orgId, orgId), eq(schema.convContacts.email, lowerEmail)))
        .limit(1);
      if (existing[0]) {
        if (input.visitor?.name && !existing[0].name) {
          await tx
            .update(schema.convContacts)
            .set({ name: input.visitor.name, updatedAt: new Date() })
            .where(eq(schema.convContacts.id, existing[0].id));
        }
        return existing[0];
      }
    }
    // No email — match on session.
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
    if (sessionRows[0]) return sessionRows[0];

    const [created] = await tx
      .insert(schema.convContacts)
      .values({
        orgId,
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
    input: WidgetIngestInputT,
  ): Promise<{ id: string; displayId: number }> {
    const existing = await tx
      .select({ id: schema.convConversations.id, displayId: schema.convConversations.displayId })
      .from(schema.convConversations)
      .where(
        and(
          eq(schema.convConversations.orgId, orgId),
          eq(schema.convConversations.channelId, channelId),
          sql`${schema.convConversations.metadata}->>'sessionId' = ${input.sessionId}`,
        ),
      )
      .limit(1);
    if (existing[0]) return existing[0];

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
