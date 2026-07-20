import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { getCurrentContext } from '@getmunin/core';
import { schema } from '@getmunin/db';
import { EmailService } from '../email/email.service.ts';
import {
  CredentialHandoffService,
  type CredentialLink,
} from '../../credential-handoff/credential-handoff.service.ts';
import type {
  CredentialApplyResult,
  CredentialTargetDescription,
  CredentialTargetHandler,
} from '../../credential-handoff/credential-target.ts';

/**
 * Wires conversation channels into the credential-handoff flow so a human can
 * enter a channel's secrets (SMTP/IMAP passwords) through a one-time dashboard
 * link instead of pasting them into an agent conversation. Email today; other
 * vendors as their providers gain secret-only application.
 */
@Injectable()
export class ChannelCredentialService implements CredentialTargetHandler {
  readonly targetType = 'channel';

  constructor(
    @Inject(EmailService) private readonly email: EmailService,
    @Inject(CredentialHandoffService) private readonly handoff: CredentialHandoffService,
  ) {}

  async requestLink(channelId: string): Promise<CredentialLink> {
    const ctx = getCurrentContext();
    const rows = await ctx.db
      .select({ id: schema.convChannels.id, type: schema.convChannels.type })
      .from(schema.convChannels)
      .where(eq(schema.convChannels.id, channelId))
      .limit(1);
    const channel = rows[0];
    if (!channel) throw new NotFoundException(`conv_not_found: channel ${channelId} not found`);
    if (channel.type !== 'email') {
      throw new BadRequestException(
        `conv_invalid: credential links are only available for email channels`,
      );
    }
    return this.handoff.mint({ targetType: this.targetType, targetId: channelId });
  }

  async describe(targetId: string): Promise<CredentialTargetDescription | null> {
    const described = await this.email.describeCredentials(targetId);
    if (!described) return null;
    return { label: described.label, vendor: 'email', fields: described.fields };
  }

  apply(targetId: string, secrets: Record<string, string>): Promise<CredentialApplyResult> {
    return this.email.applyCredentials(targetId, secrets);
  }
}
