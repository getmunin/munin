import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { schema } from '@getmunin/db';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { getCurrentContext } from '@getmunin/core';
import { z } from 'zod';
import { AddressDeliverabilityService } from '../../crm/address-deliverability.service.ts';
import { ConvInvalidError, ConvService, type ConversationDetail } from '../conv.service.ts';
import { EmailService } from './email.service.ts';

export type EmailConversationDelivery = 'queued' | 'awaiting_approval';

export const StartEmailConversationInput = z.object({
  email: z.string().trim().email().max(320).describe('Address the conversation is sent to.'),
  name: z.string().trim().min(1).max(200).optional().describe(
    "Recipient's name, used when this address has no contact yet.",
  ),
  subject: z.string().trim().min(1).max(500),
  body: z.string().min(1).max(50_000),
  channelId: z.string().min(1).max(64).optional().describe(
    'Email channel to send from. Required when the org has more than one active email channel.',
  ),
  topicId: z.string().min(1).max(64).optional(),
});

export type StartEmailConversationInputT = z.infer<typeof StartEmailConversationInput>;

export interface StartedEmailConversation {
  delivery: EmailConversationDelivery;
  conversation: ConversationDetail;
}

type ConversationCreator = Pick<ConvService, 'createConversation'>;
type ContactResolver = Pick<EmailService, 'findOrCreateContactByEmail'>;
type DeliverabilityLookup = Pick<AddressDeliverabilityService, 'lookup'>;

@Injectable()
export class EmailConversationStarter {
  constructor(
    @Inject(ConvService) private readonly conv: ConversationCreator,
    @Inject(EmailService) private readonly email: ContactResolver,
    @Inject(AddressDeliverabilityService) private readonly deliverability: DeliverabilityLookup,
  ) {}

  async start(input: StartEmailConversationInputT): Promise<StartedEmailConversation> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const address = input.email.trim().toLowerCase();
    const subject = input.subject.trim();
    if (!subject) throw new ConvInvalidError('subject must not be blank');

    const channelId = await this.resolveChannel(input.channelId);
    if (input.topicId) await this.assertTopicExists(input.topicId);
    await this.assertReachable(address);

    const contact = await ctx.db.transaction((tx) =>
      this.email.findOrCreateContactByEmail(tx, actor.orgId, address, input.name),
    );

    const isPerson = actor.type === 'user';
    const conversation = await this.conv.createConversation({
      channelId,
      subject,
      body: input.body,
      contactId: contact.id,
      endUserId: contact.endUserId ?? undefined,
      topicId: input.topicId,
      firstMessageAsDraft: !isPerson,
      authorType: isPerson ? 'user' : 'agent',
      authorId: actor.id,
    });
    return { delivery: isPerson ? 'queued' : 'awaiting_approval', conversation };
  }

  private async resolveChannel(channelId: string | undefined): Promise<string> {
    const ctx = getCurrentContext();
    const c = schema.convChannels;
    if (channelId) {
      const [row] = await ctx.db
        .select({ id: c.id, type: c.type, active: c.active, archivedAt: c.archivedAt })
        .from(c)
        .where(eq(c.id, channelId))
        .limit(1);
      if (!row || row.archivedAt) throw new NotFoundException(`conv_not_found: channel ${channelId}`);
      if (row.type !== 'email') {
        throw new ConvInvalidError(`channel ${channelId} is a ${row.type} channel, not an email channel`);
      }
      if (!row.active) throw new ConvInvalidError(`channel ${channelId} is not active`);
      return row.id;
    }
    const rows = await ctx.db
      .select({ id: c.id })
      .from(c)
      .where(and(eq(c.type, 'email'), eq(c.active, true), isNull(c.archivedAt)))
      .orderBy(asc(c.createdAt))
      .limit(2);
    if (rows.length === 0) throw new ConvInvalidError('no active email channel to send from');
    if (rows.length > 1) {
      throw new ConvInvalidError(
        'more than one active email channel; pass channelId to choose which one sends (conv_list_channels lists them)',
      );
    }
    return rows[0]!.id;
  }

  private async assertTopicExists(topicId: string): Promise<void> {
    const ctx = getCurrentContext();
    const [row] = await ctx.db
      .select({ id: schema.convTopics.id })
      .from(schema.convTopics)
      .where(eq(schema.convTopics.id, topicId))
      .limit(1);
    if (!row) throw new NotFoundException(`conv_not_found: topic ${topicId}`);
  }

  private async assertReachable(address: string): Promise<void> {
    const ctx = getCurrentContext();
    const [blocked] = await ctx.db
      .select({ id: schema.crmContacts.id })
      .from(schema.crmContacts)
      .where(
        and(
          sql`lower(${schema.crmContacts.email}) = ${address}`,
          eq(schema.crmContacts.doNotContact, true),
        ),
      )
      .limit(1);
    if (blocked) {
      throw new ConvInvalidError(`${address} belongs to contact ${blocked.id}, which is marked do-not-contact`);
    }
    const state = await this.deliverability.lookup(address);
    if (state?.state === 'undeliverable') {
      throw new ConvInvalidError(
        `mail cannot reach ${address} (${state.reason ?? 'no reason recorded'}, since ${state.stateChangedAt}); clear the address's deliverability state if it works again`,
      );
    }
  }
}
