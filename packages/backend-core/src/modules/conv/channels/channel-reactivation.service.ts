import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { getCurrentContext } from '@getmunin/core';
import { schema } from '@getmunin/db';
import { jsonbToStored, needsCredentials } from '../email/email.service.ts';
import { EmailChannelProbe, type EmailProbeResult } from '../email/email-probe.service.ts';
import type { StoredEmailChannelConfig } from '../email/email.service.ts';
import { ConvService } from '../conv.service.ts';

export interface EmailChannelTester {
  test(config: StoredEmailChannelConfig): Promise<EmailProbeResult>;
}

export interface ChannelActivator {
  setChannelActive(channelId: string, active: boolean): Promise<{ active: boolean }>;
}

export interface ReactivationResult {
  active: boolean;
  probe?: EmailProbeResult;
}

export interface ChannelReactivator {
  reactivateIfHealthy(channelId: string): Promise<ReactivationResult>;
}

@Injectable()
export class ChannelReactivationService {
  private readonly logger = new Logger(ChannelReactivationService.name);

  constructor(
    @Inject(EmailChannelProbe) private readonly probe: EmailChannelTester,
    @Inject(ConvService) private readonly conv: ChannelActivator,
  ) {}

  async reactivateIfHealthy(channelId: string): Promise<ReactivationResult> {
    const ctx = getCurrentContext();
    const rows = await ctx.db
      .select()
      .from(schema.convChannels)
      .where(eq(schema.convChannels.id, channelId))
      .limit(1);
    const channel = rows[0];
    if (!channel || channel.active || channel.archivedAt) {
      return { active: channel?.active ?? false };
    }
    if (channel.type !== 'email') return { active: false };
    const stored = jsonbToStored(channel.config);
    if (needsCredentials(stored)) return { active: false };

    let probe: EmailProbeResult;
    try {
      probe = await this.probe.test(stored);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`reactivation probe threw for channel=${channelId}: ${message}`);
      return { active: false, probe: { smtp: `error: ${message}`, imap: `error: ${message}` } };
    }
    if (probe.smtp !== 'ok' || probe.imap.startsWith('error')) {
      return { active: false, probe };
    }
    await this.conv.setChannelActive(channelId, true);
    return { active: true, probe };
  }
}
