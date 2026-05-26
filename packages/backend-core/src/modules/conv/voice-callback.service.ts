import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { getCurrentContext } from '@getmunin/core';
import { schema, type Db } from '@getmunin/db';
import { DB } from '../../common/db/db.module.ts';
import { VapiClientService } from './vapi/vapi-client.service.ts';
import { jsonbToStored } from './vapi/vapi.service.ts';

export interface VoiceCallbackResult {
  initiated: true;
  callId: string;
  status: string;
  channelId: string;
  to: string;
}

@Injectable()
export class VoiceCallbackService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(VapiClientService) private readonly vapi: VapiClientService,
  ) {}

  async placeCallbackForConversation(input: {
    conversationId: string;
    channelId?: string;
  }): Promise<VoiceCallbackResult> {
    const ctx = getCurrentContext();
    const orgId = ctx.actor!.orgId;

    const convRows = await ctx.db
      .select({
        id: schema.convConversations.id,
        endUserId: schema.convConversations.endUserId,
        contactId: schema.convConversations.contactId,
      })
      .from(schema.convConversations)
      .where(eq(schema.convConversations.id, input.conversationId))
      .limit(1);
    const conversation = convRows[0];
    if (!conversation) {
      throw new NotFoundException(`conversation ${input.conversationId} not found`);
    }

    if (!conversation.contactId) {
      throw new BadRequestException('conversation has no contact attached');
    }

    const contactRows = await ctx.db
      .select({ phone: schema.convContacts.phone, name: schema.convContacts.name })
      .from(schema.convContacts)
      .where(eq(schema.convContacts.id, conversation.contactId))
      .limit(1);
    const contact = contactRows[0];
    if (!contact?.phone) {
      throw new BadRequestException(
        'contact has no phone number — set a phone on the conversation contact before requesting a callback',
      );
    }

    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`);
      const baseConditions = [
        eq(schema.convChannels.orgId, orgId),
        eq(schema.convChannels.type, 'voice'),
        eq(schema.convChannels.vendor, 'vapi'),
        eq(schema.convChannels.active, true),
        isNull(schema.convChannels.archivedAt),
      ];
      let channel: typeof schema.convChannels.$inferSelect | undefined;
      if (input.channelId) {
        const explicit = await tx
          .select()
          .from(schema.convChannels)
          .where(and(...baseConditions, eq(schema.convChannels.id, input.channelId)))
          .limit(1);
        channel = explicit[0];
        if (!channel) {
          throw new NotFoundException(
            `voice channel ${input.channelId} not found, inactive, archived, or wrong type`,
          );
        }
      } else {
        const candidates = await tx
          .select()
          .from(schema.convChannels)
          .where(and(...baseConditions))
          .limit(2);
        if (candidates.length === 0) {
          throw new ConflictException('no_active_voice_channel');
        }
        if (candidates.length > 1) {
          throw new ConflictException(
            'multiple_active_voice_channels — pass channelId to pick one',
          );
        }
        channel = candidates[0]!;
      }
      const config = jsonbToStored(channel.config);
      if (!config.phoneNumberId) {
        throw new ConflictException('voice_channel_missing_phone_number_id');
      }
      const apiKey = await this.vapi.decryptString(tx, config.encryptedApiKey);
      const customerName = contact.name ?? undefined;
      try {
        const res = await this.vapi.placeCall({
          apiKey,
          assistantId: config.assistantId,
          phoneNumberId: config.phoneNumberId,
          toNumber: contact.phone!,
          customer: customerName ? { name: customerName } : undefined,
        });
        return {
          initiated: true,
          callId: res.id,
          status: res.status,
          channelId: channel.id,
          to: contact.phone!,
        };
      } catch (err) {
        throw new BadRequestException(err instanceof Error ? err.message : String(err));
      }
    });
  }
}
