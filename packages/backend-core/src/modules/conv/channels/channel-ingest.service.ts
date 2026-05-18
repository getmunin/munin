import { Inject, Injectable, Logger } from '@nestjs/common';
import { schema, type Db, type Tx } from '@getmunin/db';
import { and, eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import {
  ActorIdentity,
  WebhookDispatcher,
  withContext,
  type RequestContext,
} from '@getmunin/core';
import { DB } from '../../../common/db/db.module.js';
import type { ChannelRow, InboundBatch } from './adapter.js';

@Injectable()
export class ChannelIngestService {
  private readonly logger = new Logger(ChannelIngestService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(WebhookDispatcher) private readonly webhooks: WebhookDispatcher,
  ) {}

  async ingest(channel: ChannelRow, batch: InboundBatch): Promise<{ ingested: number }> {
    let ingested = 0;
    for (const msg of batch.messages) {
      try {
        const wasIngested = await this.ingestOne(channel, msg);
        if (wasIngested) ingested += 1;
      } catch (err) {
        this.logger.error(
          `ingest failed channel=${channel.id} providerMessageId=${msg.providerMessageId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return { ingested };
  }

  private async ingestOne(channel: ChannelRow, msg: InboundBatch['messages'][number]): Promise<boolean> {
    const orgId = channel.orgId;
    const actor = new ActorIdentity(
      'system',
      `channel-webhook-${channel.type}`,
      orgId,
      ['*'],
      ['admin'],
    );

    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`);
      const ctx: RequestContext = { db: tx, actor, correlationId: randomUUID() };
      return withContext(ctx, async () => {
        const dup = await tx
          .select({ id: schema.convMessages.id })
          .from(schema.convMessages)
          .where(
            and(
              eq(schema.convMessages.orgId, orgId),
              sql`${schema.convMessages.metadata}->>'providerMessageId' = ${msg.providerMessageId}`,
            ),
          )
          .limit(1);
        if (dup[0]) return false;

        const contact = await findOrCreateContact(tx, orgId, msg.fromIdentity);

        const next = await tx.execute<{ next: number } & Record<string, unknown>>(
          sql`SELECT conv_next_display_id(${orgId}) AS next`,
        );
        const displayId = next[0]!.next;
        const [conversation] = await tx
          .insert(schema.convConversations)
          .values({
            orgId,
            displayId,
            channelId: channel.id,
            contactId: contact.id,
            endUserId: contact.endUserId,
            status: 'open',
            subject: null,
            lastMessageAt: msg.receivedAt,
          })
          .returning();

        const metadata: Record<string, unknown> = {
          providerMessageId: msg.providerMessageId,
        };
        if (msg.inReplyTo) metadata.inReplyTo = msg.inReplyTo;
        if (msg.raw) metadata.raw = msg.raw;

        const [stored] = await tx
          .insert(schema.convMessages)
          .values({
            orgId,
            conversationId: conversation!.id,
            authorType: 'end_user',
            authorId: contact.id,
            body: msg.body,
            bodyHtml: msg.bodyHtml ?? null,
            internal: false,
            metadata,
          })
          .returning();

        await tx
          .update(schema.convConversations)
          .set({ lastMessageAt: msg.receivedAt, updatedAt: new Date() })
          .where(eq(schema.convConversations.id, conversation!.id));

        await this.webhooks.emit({
          type: 'conversation.message.received',
          payload: {
            conversationId: conversation!.id,
            messageId: stored!.id,
            authorType: 'end_user',
            internal: false,
          },
        });
        return true;
      });
    });
  }
}

async function findOrCreateContact(
  tx: Db | Tx,
  orgId: string,
  identity: InboundBatch['messages'][number]['fromIdentity'],
): Promise<typeof schema.convContacts.$inferSelect> {
  const email = identity.email?.trim().toLowerCase() || null;
  const phone = identity.phone?.trim() || null;
  const name = identity.name?.trim() || null;

  if (email) {
    const existing = await tx
      .select()
      .from(schema.convContacts)
      .where(and(eq(schema.convContacts.orgId, orgId), eq(schema.convContacts.email, email)))
      .limit(1);
    if (existing[0]) return existing[0];
  }
  if (phone) {
    const existing = await tx
      .select()
      .from(schema.convContacts)
      .where(and(eq(schema.convContacts.orgId, orgId), eq(schema.convContacts.phone, phone)))
      .limit(1);
    if (existing[0]) return existing[0];
  }

  const externalId = email ? `email:${email}` : phone ? `phone:${phone}` : null;
  let endUserId: string | null = null;
  if (externalId) {
    const existingEu = await tx
      .select()
      .from(schema.endUsers)
      .where(and(eq(schema.endUsers.orgId, orgId), eq(schema.endUsers.externalId, externalId)))
      .limit(1);
    if (existingEu[0]) {
      endUserId = existingEu[0].id;
    } else {
      try {
        const [created] = await tx
          .insert(schema.endUsers)
          .values({
            orgId,
            externalId,
            email,
            phone,
            name,
            metadata: { source: 'channel-webhook' },
          })
          .returning();
        endUserId = created!.id;
      } catch {
        const reread = await tx
          .select()
          .from(schema.endUsers)
          .where(and(eq(schema.endUsers.orgId, orgId), eq(schema.endUsers.externalId, externalId)))
          .limit(1);
        if (reread[0]) endUserId = reread[0].id;
      }
    }
  }

  const [contact] = await tx
    .insert(schema.convContacts)
    .values({
      orgId,
      email,
      phone,
      name,
      endUserId,
      metadata: {},
    })
    .returning();
  return contact!;
}
