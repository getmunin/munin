import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { getCurrentContext } from '@getmunin/core';
import { schema, type Db } from '@getmunin/db';
import { DB } from '../../../common/db/db.module.ts';
import { EmailService, jsonbToStored } from '../email/email.service.ts';
import { EmailChannelProbe, type EmailProbeResult } from '../email/email-probe.service.ts';
import type { StoredEmailChannelConfig } from '../email/email.service.ts';
import {
  CredentialHandoffService,
  type CredentialLink,
} from '../../credential-handoff/credential-handoff.service.ts';
import type {
  CredentialApplyResult,
  CredentialTargetDescription,
  CredentialTargetHandler,
} from '../../credential-handoff/credential-target.ts';

export interface EmailChannelTester {
  test(config: StoredEmailChannelConfig): Promise<EmailProbeResult>;
}

@Injectable()
export class ChannelCredentialService implements CredentialTargetHandler {
  readonly targetType = 'channel';

  constructor(
    @Inject(EmailService) private readonly email: EmailService,
    @Inject(CredentialHandoffService) private readonly handoff: CredentialHandoffService,
    @Inject(EmailChannelProbe) private readonly probe: EmailChannelTester,
    @Inject(DB) private readonly db: Db,
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

  async verify(targetId: string): Promise<CredentialApplyResult> {
    const row = await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`);
      const rows = await tx
        .select()
        .from(schema.convChannels)
        .where(eq(schema.convChannels.id, targetId))
        .limit(1);
      return rows[0] ?? null;
    });
    if (!row || row.type !== 'email') return { ok: false, error: 'channel no longer exists' };
    const result = await this.probe.test(jsonbToStored(row.config));
    const detail = `SMTP ${result.smtp}; IMAP ${result.imap}`;
    const ok = result.smtp === 'ok' && !result.imap.startsWith('error');
    return ok ? { ok, detail } : { ok, error: detail };
  }
}
