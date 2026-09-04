import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import {
  ActorIdentity,
  getCurrentContext,
  setEncryptionKeySql,
  withContext,
  type RequestContext,
} from '@getmunin/core';
import { schema, type Db } from '@getmunin/db';
import { DB } from '../../../common/db/db.module.ts';
import { EmailService, jsonbToStored } from '../email/email.service.ts';
import { EmailChannelProbe, type EmailProbeResult } from '../email/email-probe.service.ts';
import type { StoredEmailChannelConfig } from '../email/email.service.ts';
import { ChannelAdminService } from './channel-admin.service.ts';
import { ChannelConfigInvalidError } from './stored-config.ts';
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
  test(config: StoredEmailChannelConfig, orgId?: string): Promise<EmailProbeResult>;
}

function asHttpConfigError(err: unknown): Error {
  if (err instanceof ChannelConfigInvalidError) {
    return new BadRequestException({
      message: err.message,
      code: err.code,
      fieldErrors: err.fieldErrors,
    });
  }
  return err instanceof Error ? err : new Error(String(err));
}

@Injectable()
export class ChannelCredentialService implements CredentialTargetHandler {
  readonly targetType = 'channel';

  constructor(
    @Inject(EmailService) private readonly email: EmailService,
    @Inject(CredentialHandoffService) private readonly handoff: CredentialHandoffService,
    @Inject(EmailChannelProbe) private readonly probe: EmailChannelTester,
    @Inject(DB) private readonly db: Db,
    @Inject(ChannelAdminService) private readonly admin: ChannelAdminService,
  ) {}

  async requestLink(channelId: string): Promise<CredentialLink> {
    const ctx = getCurrentContext();
    const rows = await ctx.db
      .select({ id: schema.convChannels.id, type: schema.convChannels.type, vendor: schema.convChannels.vendor })
      .from(schema.convChannels)
      .where(eq(schema.convChannels.id, channelId))
      .limit(1);
    const channel = rows[0];
    if (!channel) throw new NotFoundException(`conv_not_found: channel ${channelId} not found`);
    if (channel.type !== 'email' && !this.admin.providerFor(channel.vendor)?.completeSetup) {
      throw new BadRequestException(
        `conv_invalid: credential links are not available for '${channel.vendor}' channels`,
      );
    }
    return this.handoff.mint({ targetType: this.targetType, targetId: channelId });
  }

  async describe(targetId: string): Promise<CredentialTargetDescription | null> {
    try {
      return await this.describeTarget(targetId);
    } catch (err) {
      throw asHttpConfigError(err);
    }
  }

  async apply(targetId: string, secrets: Record<string, string>): Promise<CredentialApplyResult> {
    try {
      return await this.applyToTarget(targetId, secrets);
    } catch (err) {
      if (err instanceof ChannelConfigInvalidError) return { ok: false, error: err.message };
      throw err;
    }
  }

  private async describeTarget(targetId: string): Promise<CredentialTargetDescription | null> {
    const ctx = getCurrentContext();
    const rows = await ctx.db
      .select({ name: schema.convChannels.name, type: schema.convChannels.type, vendor: schema.convChannels.vendor })
      .from(schema.convChannels)
      .where(eq(schema.convChannels.id, targetId))
      .limit(1);
    const channel = rows[0];
    if (!channel) return null;
    if (channel.type === 'email') {
      const described = await this.email.describeCredentials(targetId);
      if (!described) return null;
      return { label: described.label, vendor: 'email', fields: described.fields };
    }
    const provider = this.admin.providerFor(channel.vendor);
    if (!provider?.completeSetup) return null;
    return {
      label: channel.name,
      vendor: provider.vendor,
      fields: provider.configFields
        .filter((f) => f.secret)
        .map((f) => ({ key: f.name, label: f.name, required: true })),
    };
  }

  private async applyToTarget(
    targetId: string,
    secrets: Record<string, string>,
  ): Promise<CredentialApplyResult> {
    const ctx = getCurrentContext();
    const rows = await ctx.db
      .select({ type: schema.convChannels.type })
      .from(schema.convChannels)
      .where(eq(schema.convChannels.id, targetId))
      .limit(1);
    if (!rows[0]) return { ok: false, error: 'channel no longer exists' };
    if (rows[0].type === 'email') return this.email.applyCredentials(targetId, secrets);
    return this.admin.completeSetup(targetId, secrets);
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
    if (!row) return { ok: false, error: 'channel no longer exists' };
    if (row.type === 'email') {
      const result = await this.probe.test(jsonbToStored(row.config), row.orgId);
      const detail = `SMTP ${result.smtp}; IMAP ${result.imap}`;
      const ok = !result.smtp.startsWith('error') && !result.imap.startsWith('error');
      return ok ? { ok, detail } : { ok, error: detail };
    }
    const provider = this.admin.providerFor(row.vendor);
    if (!provider) return { ok: true, detail: 'credentials saved' };
    try {
      const result = await this.db.transaction(async (tx) => {
        await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`);
        await tx.execute(setEncryptionKeySql());
        const actor = new ActorIdentity('system', 'credential-handoff', row.orgId, ['*'], ['admin']);
        const ctx: RequestContext = { db: tx, actor, correlationId: randomUUID() };
        return withContext(ctx, () => provider.test(targetId));
      });
      const shaped = result as { ok?: boolean; error?: string } | null;
      if (shaped && shaped.ok === false) {
        return { ok: false, error: shaped.error ?? 'credential test failed' };
      }
      return { ok: true, detail: 'credentials saved and verified' };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}
