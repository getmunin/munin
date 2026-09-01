import { Inject, Injectable, Logger } from '@nestjs/common';
import { schema, type Db, type Tx } from '@getmunin/db';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import {
  ActorIdentity,
  WebhookDispatcher,
  withContext,
  type RequestContext,
} from '@getmunin/core';
import { DB } from '../../../common/db/db.module.ts';
import { findOrCreateEndUserByEmail } from '../end-user-by-email.ts';
import { CuratorJobsService } from '../../curator/curator-jobs.service.ts';
import { buildSetTopicAndTitleJob } from '../set-topic-job.ts';
import { reopenClosedConversation } from '../conversation-reopen.ts';
import { raiseAttentionWhenAgentIsOff } from '../unanswerable-handover.ts';
import type { ChannelRow, InboundBatch } from './adapter.ts';

@Injectable()
export class ChannelIngestService {
  private readonly logger = new Logger(ChannelIngestService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(WebhookDispatcher) private readonly webhooks: WebhookDispatcher,
    @Inject(CuratorJobsService) private readonly curatorJobs: CuratorJobsService,
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

        const conversation =
          (await findThreadableConversation(tx, orgId, channel.id, contact.id)) ??
          (await createConversation(tx, orgId, channel, contact, msg.receivedAt));

        const metadata: Record<string, unknown> = {
          providerMessageId: msg.providerMessageId,
        };
        if (msg.inReplyTo) metadata.inReplyTo = msg.inReplyTo;
        if (msg.raw) metadata.raw = msg.raw;

        const [stored] = await tx
          .insert(schema.convMessages)
          .values({
            orgId,
            conversationId: conversation.id,
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
          .where(eq(schema.convConversations.id, conversation.id));

        await raiseAttentionWhenAgentIsOff(tx, conversation.id);

        await this.webhooks.emit({
          type: 'conversation.message.received',
          payload: {
            conversationId: conversation.id,
            messageId: stored!.id,
            authorType: 'end_user',
            internal: false,
          },
        });
        if (channel.type === 'sms' && isOptOutKeyword(msg.body)) {
          await suppressContactByPhone(tx, orgId, contact.phone, channel.id);
        }

        await this.curatorJobs.enqueue(
          buildSetTopicAndTitleJob({ conversationId: conversation.id, channelType: channel.type }),
        );
        return true;
      });
    });
  }
}

const OPT_OUT_KEYWORDS = new Set([
  'stop',
  'stopp',
  'slutt',
  'stopall',
  'unsubscribe',
  'end',
  'quit',
  'cancel',
  'avmeld',
]);

export function isOptOutKeyword(body: string): boolean {
  const normalised = body
    .trim()
    .toLowerCase()
    .replace(/[.!?,;:]+$/g, '');
  return OPT_OUT_KEYWORDS.has(normalised);
}

async function suppressContactByPhone(
  tx: Db | Tx,
  orgId: string,
  phone: string | null,
  channelId: string,
): Promise<void> {
  if (!phone) return;
  const rows = await tx
    .select({ id: schema.crmContacts.id, unsubscribedAt: schema.crmContacts.unsubscribedAt })
    .from(schema.crmContacts)
    .where(and(eq(schema.crmContacts.orgId, orgId), eq(schema.crmContacts.phone, phone)))
    .limit(1);
  const contact = rows[0];
  if (!contact || contact.unsubscribedAt) return;
  const now = new Date();
  await tx
    .update(schema.crmContacts)
    .set({ unsubscribedAt: now, doNotContact: true, updatedAt: now })
    .where(eq(schema.crmContacts.id, contact.id));
  await tx.insert(schema.crmActivities).values({
    orgId,
    type: 'note',
    subject: 'Unsubscribed',
    body: 'Replied with an opt-out keyword over SMS',
    contactId: contact.id,
    actorType: 'system',
    actorId: 'sms-opt-out',
    metadata: { optOut: { channelId, via: 'sms_keyword' } },
  });
}

async function findThreadableConversation(
  tx: Db | Tx,
  orgId: string,
  channelId: string,
  contactId: string,
): Promise<typeof schema.convConversations.$inferSelect | null> {
  const rows = await tx
    .select()
    .from(schema.convConversations)
    .where(
      and(
        eq(schema.convConversations.orgId, orgId),
        eq(schema.convConversations.channelId, channelId),
        eq(schema.convConversations.contactId, contactId),
        inArray(schema.convConversations.status, ['open', 'snoozed']),
      ),
    )
    .orderBy(desc(schema.convConversations.lastMessageAt))
    .limit(1);
  const conversation = rows[0];
  if (!conversation) return null;
  if (conversation.status === 'snoozed') {
    await reopenClosedConversation(tx, conversation.id);
    return { ...conversation, status: 'open' };
  }
  return conversation;
}

async function createConversation(
  tx: Db | Tx,
  orgId: string,
  channel: ChannelRow,
  contact: typeof schema.convContacts.$inferSelect,
  receivedAt: Date,
): Promise<typeof schema.convConversations.$inferSelect> {
  const next = await tx.execute<{ next: number } & Record<string, unknown>>(
    sql`SELECT conv_next_display_id(${orgId}) AS next`,
  );
  const [conversation] = await tx
    .insert(schema.convConversations)
    .values({
      orgId,
      displayId: next[0]!.next,
      channelId: channel.id,
      contactId: contact.id,
      endUserId: contact.endUserId,
      status: 'open',
      subject: null,
      agentMode: channel.defaultAgentMode,
      lastMessageAt: receivedAt,
    })
    .returning();
  return conversation!;
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

  let endUserId: string | null = null;
  if (email) {
    endUserId = await findOrCreateEndUserByEmail(tx, orgId, email, name, 'channel-webhook');
  } else if (phone) {
    const externalId = `phone:${phone}`;
    const existingEu = await tx
      .select({ id: schema.endUsers.id })
      .from(schema.endUsers)
      .where(and(eq(schema.endUsers.orgId, orgId), eq(schema.endUsers.externalId, externalId)))
      .limit(1);
    if (existingEu[0]) {
      endUserId = existingEu[0].id;
    } else {
      const [created] = await tx
        .insert(schema.endUsers)
        .values({
          orgId,
          externalId,
          phone,
          name,
          metadata: { source: 'channel-webhook' },
        })
        .onConflictDoUpdate({
          target: [schema.endUsers.orgId, schema.endUsers.externalId],
          set: { updatedAt: new Date() },
        })
        .returning({ id: schema.endUsers.id });
      endUserId = created!.id;
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
