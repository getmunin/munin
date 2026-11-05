import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { schema } from '@getmunin/db';
import { getCurrentContext } from '@getmunin/core';
import { JourneySpecSchema, type JourneyNode } from '@getmunin/types';
import { EmailAdapter, type BulkEmail, type BulkEmailResult } from '../conv/email/email-adapter.ts';
import type { ChannelRow } from '../conv/channels/adapter.ts';
import { broadcastUnsubscribeUrl } from '../outreach/outreach-broadcasts.service.ts';
import { resolveTestRecipient } from '../outreach/test-recipient.ts';
import { JourneysService } from './journeys.service.ts';
import { JourneySimulator } from './journey-simulator.ts';

const TEST_SEND_CONTACT_ID = 'test-send';

export interface TestEmailSender {
  sendBulk(channel: ChannelRow, messages: readonly BulkEmail[]): Promise<BulkEmailResult[]>;
}

export interface JourneyTestSendResult {
  sent: true;
  to: string;
  version: number;
  nodeId: string;
  contactId: string;
  subject: string;
  messageId: string;
}

@Injectable()
export class JourneyTestSendService {
  constructor(
    @Inject(JourneysService) private readonly journeys: Pick<JourneysService, 'get' | 'getVersion'>,
    @Inject(JourneySimulator) private readonly simulator: Pick<JourneySimulator, 'sampleContact' | 'renderEmailSample'>,
    @Inject(EmailAdapter) private readonly mail: TestEmailSender,
  ) {}

  async sendTest(input: {
    journeyId: string;
    nodeId: string;
    to?: string | null;
    contactId?: string;
    version?: number;
  }): Promise<JourneyTestSendResult> {
    const ctx = getCurrentContext();
    const journey = await this.journeys.get(input.journeyId);
    const row = input.version
      ? await this.journeys.getVersion(input.journeyId, input.version)
      : (journey.draft ?? journey.live);
    if (!row) throw new NotFoundException(`journeys_not_found: journey ${input.journeyId} has no version to test`);
    const parsed = JourneySpecSchema.safeParse(row.spec);
    if (!parsed.success) {
      throw new BadRequestException(`journeys_invalid: version ${row.number} does not parse; run journeys_validate`);
    }
    const node = parsed.data.nodes.find((n): n is Extract<JourneyNode, { type: 'message' }> => n.id === input.nodeId && n.type === 'message');
    if (!node || node.channel !== 'email') {
      throw new BadRequestException(`journeys_invalid: ${input.nodeId} is not an email step in version ${row.number}`);
    }
    const channel = await this.loadEmailChannel(await this.senderChannelId(journey));
    const to = await resolveTestRecipient(input.to ?? null);
    const contact = await this.simulator.sampleContact(parsed.data, journey.id, input.contactId);
    if (!contact) {
      throw new BadRequestException(
        input.contactId
          ? `journeys_invalid: contact ${input.contactId} does not exist`
          : 'journeys_invalid: there is no contact to use as the sample; pass contactId',
      );
    }
    const rendered = await this.simulator.renderEmailSample(node, contact, {
      unsubscribeUrl: broadcastUnsubscribeUrl(ctx.actor!.orgId, TEST_SEND_CONTACT_ID, journey.id),
    });
    const subject = `[Test] ${rendered.subject}`;
    const [result] = await this.mail.sendBulk(channel, [
      { key: 'test', to, subject, html: rendered.html, text: rendered.text, replyKey: 'test' },
    ]);
    if (!result?.messageId) {
      throw new BadRequestException(`journeys_invalid: test send to ${to} failed: ${result?.error ?? 'no result from the channel'}`);
    }
    return {
      sent: true,
      to,
      version: row.number,
      nodeId: node.id,
      contactId: contact.id,
      subject,
      messageId: result.messageId,
    };
  }

  private async senderChannelId(journey: { id: string; senderChannelId: string | null; outreachCampaignId: string | null }): Promise<string> {
    if (journey.senderChannelId) return journey.senderChannelId;
    if (journey.outreachCampaignId) {
      const ctx = getCurrentContext();
      const [campaign] = await ctx.db
        .select({ channelId: schema.outreachCampaigns.channelId })
        .from(schema.outreachCampaigns)
        .where(eq(schema.outreachCampaigns.id, journey.outreachCampaignId))
        .limit(1);
      if (campaign?.channelId) return campaign.channelId;
    }
    throw new BadRequestException(`journeys_invalid: journey ${journey.id} has no email sender channel`);
  }

  private async loadEmailChannel(channelId: string): Promise<ChannelRow> {
    const ctx = getCurrentContext();
    const [channel] = await ctx.db
      .select()
      .from(schema.convChannels)
      .where(eq(schema.convChannels.id, channelId))
      .limit(1);
    if (!channel || channel.type !== 'email') {
      throw new BadRequestException(`journeys_invalid: sender channel ${channelId} is not an email channel`);
    }
    if (!channel.active) throw new BadRequestException(`journeys_invalid: sender channel ${channelId} is not active`);
    return channel;
  }
}
