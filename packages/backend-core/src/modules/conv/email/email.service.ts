import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { schema, type Db, type Tx } from '@getmunin/db';
import { and, desc, eq, isNotNull, sql } from 'drizzle-orm';
import {
  assertPublicHost,
  decryptSecretSql,
  encryptSecretSql,
  getCurrentContext,
  setEncryptionKeySql,
  SsrfBlockedError,
} from '@getmunin/core';
import { z } from 'zod';
import {
  EmailChannelConfigInput,
  SendLimitsSchema,
  type AgentMode,
  type EmailChannelConfigInputT,
  type SendLimits,
} from '@getmunin/types';

export { EmailChannelConfigInput };
export type { EmailChannelConfigInputT };

const REDACTED_PASSWORD = '••••';

export interface EmailChannelConfigDto {
  addressing: {
    fromAddress: string;
    fromName?: string;
    replyToTemplate?: string;
  };
  outbound:
    | { provider: 'mailer'; trackOpens?: boolean }
    | {
        provider: 'smtp';
        host: string;
        port: number;
        secure: boolean;
        username: string;
        password: typeof REDACTED_PASSWORD;
        trackOpens?: boolean;
      };
  inbound?: {
    provider: 'imap';
    host: string;
    port: number;
    secure: boolean;
    username: string;
    password: typeof REDACTED_PASSWORD;
    mailbox?: string;
  };
  sendLimits?: SendLimits;
}

const StoredSmtpOutboundSchema = z.object({
  provider: z.literal('smtp'),
  host: z.string(),
  port: z.number().int(),
  secure: z.boolean(),
  username: z.string(),
  encryptedPassword: z.string(),
  trackOpens: z.boolean().optional(),
});

const StoredMailerOutboundSchema = z.object({
  provider: z.literal('mailer'),
  trackOpens: z.boolean().optional(),
});

const StoredImapInboundSchema = z.object({
  provider: z.literal('imap'),
  host: z.string(),
  port: z.number().int(),
  secure: z.boolean(),
  username: z.string(),
  encryptedPassword: z.string(),
  mailbox: z.string().optional(),
});

export const StoredEmailChannelConfigSchema = z.object({
  addressing: z.object({
    fromAddress: z.string(),
    fromName: z.string().optional(),
    replyToTemplate: z.string().optional(),
  }),
  outbound: z.discriminatedUnion('provider', [
    StoredSmtpOutboundSchema,
    StoredMailerOutboundSchema,
  ]),
  inbound: StoredImapInboundSchema.optional(),
  sendLimits: SendLimitsSchema.optional(),
});

export type StoredEmailChannelConfig = z.infer<typeof StoredEmailChannelConfigSchema>;

@Injectable()
export class EmailService {
  async toStored(input: EmailChannelConfigInputT): Promise<StoredEmailChannelConfig> {
    if (input.outbound.provider === 'smtp') {
      await assertReachableMailHost('SMTP', input.outbound.host);
    }
    if (input.inbound) {
      await assertReachableMailHost('IMAP', input.inbound.host);
    }
    const out: StoredEmailChannelConfig = {
      addressing: { ...input.addressing },
      outbound:
        input.outbound.provider === 'smtp'
          ? {
              provider: 'smtp',
              host: input.outbound.host,
              port: input.outbound.port,
              secure: input.outbound.secure,
              username: input.outbound.username,
              encryptedPassword: input.outbound.password
                ? await encryptString(input.outbound.password)
                : '',
              ...(input.outbound.trackOpens !== undefined
                ? { trackOpens: input.outbound.trackOpens }
                : {}),
            }
          : {
              provider: 'mailer',
              ...(input.outbound.trackOpens !== undefined
                ? { trackOpens: input.outbound.trackOpens }
                : {}),
            },
    };
    if (input.inbound) {
      out.inbound = {
        provider: 'imap',
        host: input.inbound.host,
        port: input.inbound.port,
        secure: input.inbound.secure,
        username: input.inbound.username,
        encryptedPassword: input.inbound.password
          ? await encryptString(input.inbound.password)
          : '',
        mailbox: input.inbound.mailbox,
      };
    }
    if (input.sendLimits) {
      const trimmed: SendLimits = {};
      if (input.sendLimits.perDayMax !== undefined) trimmed.perDayMax = input.sendLimits.perDayMax;
      if (input.sendLimits.perHourMax !== undefined) trimmed.perHourMax = input.sendLimits.perHourMax;
      if (Object.keys(trimmed).length > 0) out.sendLimits = trimmed;
    }
    return out;
  }

  toDto(stored: StoredEmailChannelConfig): EmailChannelConfigDto {
    const out: EmailChannelConfigDto = {
      addressing: { ...stored.addressing },
      outbound:
        stored.outbound.provider === 'smtp'
          ? {
              provider: 'smtp',
              host: stored.outbound.host,
              port: stored.outbound.port,
              secure: stored.outbound.secure,
              username: stored.outbound.username,
              password: REDACTED_PASSWORD,
              ...(stored.outbound.trackOpens !== undefined
                ? { trackOpens: stored.outbound.trackOpens }
                : {}),
            }
          : {
              provider: 'mailer',
              ...(stored.outbound.trackOpens !== undefined
                ? { trackOpens: stored.outbound.trackOpens }
                : {}),
            },
    };
    if (stored.inbound) {
      out.inbound = {
        provider: 'imap',
        host: stored.inbound.host,
        port: stored.inbound.port,
        secure: stored.inbound.secure,
        username: stored.inbound.username,
        password: REDACTED_PASSWORD,
        mailbox: stored.inbound.mailbox,
      };
    }
    if (stored.sendLimits) out.sendLimits = { ...stored.sendLimits };
    return out;
  }

  async describeCredentials(
    channelId: string,
  ): Promise<{ label: string; fields: Array<{ key: string; label: string; required: boolean }> } | null> {
    const ctx = getCurrentContext();
    const rows = await ctx.db
      .select()
      .from(schema.convChannels)
      .where(eq(schema.convChannels.id, channelId))
      .limit(1);
    const channel = rows[0];
    if (!channel || channel.type !== 'email') return null;
    const stored = jsonbToStored(channel.config);
    const fields: Array<{ key: string; label: string; required: boolean }> = [];
    if (stored.outbound.provider === 'smtp') {
      fields.push({ key: 'smtpPassword', label: 'SMTP password', required: true });
    }
    if (stored.inbound) {
      fields.push({ key: 'imapPassword', label: 'IMAP password', required: true });
    }
    if (fields.length === 0) return null;
    return { label: channel.name, fields };
  }

  async applyCredentials(
    channelId: string,
    secrets: Record<string, string>,
  ): Promise<{ ok: boolean; detail?: string; error?: string }> {
    const ctx = getCurrentContext();
    const rows = await ctx.db
      .select()
      .from(schema.convChannels)
      .where(eq(schema.convChannels.id, channelId))
      .limit(1);
    const channel = rows[0];
    if (!channel || channel.type !== 'email') {
      return { ok: false, error: 'channel is not an email channel' };
    }
    const stored = jsonbToStored(channel.config);
    if (secrets.smtpPassword && stored.outbound.provider === 'smtp') {
      stored.outbound.encryptedPassword = await encryptString(secrets.smtpPassword);
    }
    if (secrets.imapPassword && stored.inbound) {
      stored.inbound.encryptedPassword = await encryptString(secrets.imapPassword);
    }
    await ctx.db
      .update(schema.convChannels)
      .set({ config: storedToJsonb(stored), updatedAt: new Date() })
      .where(eq(schema.convChannels.id, channel.id));
    return { ok: true, detail: 'credentials saved — run conv_test_email_channel to verify' };
  }

  async decryptSmtpPassword(tx: Db | Tx, encryptedPassword: string): Promise<string> {
    if (!encryptedPassword) return '';
    return decryptString(tx, encryptedPassword);
  }

  async decryptImapPassword(tx: Db | Tx, encryptedPassword: string): Promise<string> {
    if (!encryptedPassword) return '';
    return decryptString(tx, encryptedPassword);
  }

  async createChannel(input: {
    name: string;
    config: EmailChannelConfigInputT;
    defaultAgentMode?: AgentMode;
  }): Promise<{
    id: string;
    name: string;
    type: 'email';
    active: boolean;
    config: EmailChannelConfigDto;
    defaultAgentMode: AgentMode;
  }> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const stored = await this.toStored(input.config);
    const [row] = await ctx.db
      .insert(schema.convChannels)
      .values({
        orgId: actor.orgId,
        type: 'email',
        vendor: stored.outbound.provider,
        name: input.name,
        config: storedToJsonb(stored),
        ...(input.defaultAgentMode ? { defaultAgentMode: input.defaultAgentMode } : {}),
      })
      .returning();
    return {
      id: row!.id,
      name: row!.name,
      type: 'email',
      active: row!.active,
      config: this.toDto(stored),
      defaultAgentMode: row!.defaultAgentMode as AgentMode,
    };
  }

  async updateChannel(input: {
    channelId: string;
    name?: string;
    config: EmailChannelConfigInputT;
    defaultAgentMode?: AgentMode;
  }): Promise<{
    id: string;
    name: string;
    type: 'email';
    active: boolean;
    config: EmailChannelConfigDto;
    defaultAgentMode: AgentMode;
  }> {
    const ctx = getCurrentContext();
    const existing = await ctx.db
      .select()
      .from(schema.convChannels)
      .where(eq(schema.convChannels.id, input.channelId))
      .limit(1);
    const channel = existing[0];
    if (!channel) throw new NotFoundException(`channel ${input.channelId} not found`);
    if (channel.type !== 'email') {
      throw new BadRequestException(`channel ${input.channelId} is not an email channel`);
    }
    const prev = jsonbToStored(channel.config);
    const merged = await this.mergeConfig(prev, input.config);
    const [row] = await ctx.db
      .update(schema.convChannels)
      .set({
        ...(input.name && { name: input.name }),
        vendor: merged.outbound.provider,
        config: storedToJsonb(merged),
        ...(input.defaultAgentMode ? { defaultAgentMode: input.defaultAgentMode } : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.convChannels.id, input.channelId))
      .returning();
    return {
      id: row!.id,
      name: row!.name,
      type: 'email',
      active: row!.active,
      config: this.toDto(merged),
      defaultAgentMode: row!.defaultAgentMode as AgentMode,
    };
  }

  private async mergeConfig(
    prev: StoredEmailChannelConfig,
    next: EmailChannelConfigInputT,
  ): Promise<StoredEmailChannelConfig> {
    const merged = await this.toStored(next);
    if (
      merged.outbound.provider === 'smtp' &&
      merged.outbound.encryptedPassword === '' &&
      prev.outbound.provider === 'smtp'
    ) {
      merged.outbound.encryptedPassword = prev.outbound.encryptedPassword;
    }
    if (
      merged.inbound &&
      merged.inbound.encryptedPassword === '' &&
      prev.inbound?.encryptedPassword
    ) {
      merged.inbound.encryptedPassword = prev.inbound.encryptedPassword;
    }
    return merged;
  }

  async lastDeliveredMessageIdHeader(conversationId: string): Promise<string | null> {
    const ctx = getCurrentContext();
    const rows = await ctx.db
      .select({ messageIdHeader: schema.convMessageDeliveries.messageIdHeader })
      .from(schema.convMessageDeliveries)
      .innerJoin(
        schema.convMessages,
        eq(schema.convMessages.id, schema.convMessageDeliveries.messageId),
      )
      .where(
        and(
          eq(schema.convMessages.conversationId, conversationId),
          eq(schema.convMessageDeliveries.status, 'sent'),
          isNotNull(schema.convMessageDeliveries.messageIdHeader),
        ),
      )
      .orderBy(desc(schema.convMessageDeliveries.sentAt))
      .limit(1);
    return rows[0]?.messageIdHeader ?? null;
  }

  async enqueueOutbound(input: {
    messageId: string;
    conversationId: string;
    channelId: string;
  }): Promise<void> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const inReplyTo = await this.lastDeliveredMessageIdHeader(input.conversationId);
    await ctx.db.insert(schema.convMessageDeliveries).values({
      orgId: actor.orgId,
      messageId: input.messageId,
      channelId: input.channelId,
      status: 'queued',
      attempt: 0,
      nextAttemptAt: new Date(),
      inReplyToHeader: inReplyTo,
    });
  }

  async findOrCreateContactByEmail(
    tx: Db | Tx,
    orgId: string,
    email: string,
    name?: string,
  ): Promise<typeof schema.convContacts.$inferSelect> {
    const lower = email.trim().toLowerCase();
    const cleanName = name?.trim() || null;
    const endUser = await this.findOrCreateEndUserByEmail(tx, orgId, lower, cleanName);

    const existing = await tx
      .select()
      .from(schema.convContacts)
      .where(and(eq(schema.convContacts.orgId, orgId), eq(schema.convContacts.email, lower)))
      .limit(1);
    if (existing[0]) {
      if (existing[0].endUserId) return existing[0];
      const [patched] = await tx
        .update(schema.convContacts)
        .set({ endUserId: endUser.id, updatedAt: new Date() })
        .where(eq(schema.convContacts.id, existing[0].id))
        .returning();
      return patched ?? existing[0];
    }
    try {
      const [row] = await tx
        .insert(schema.convContacts)
        .values({
          orgId,
          email: lower,
          name: cleanName,
          endUserId: endUser.id,
          metadata: {},
        })
        .returning();
      return row!;
    } catch (err) {
      const reread = await tx
        .select()
        .from(schema.convContacts)
        .where(and(eq(schema.convContacts.orgId, orgId), eq(schema.convContacts.email, lower)))
        .limit(1);
      if (reread[0]) return reread[0];
      throw err;
    }
  }

  private async findOrCreateEndUserByEmail(
    tx: Db | Tx,
    orgId: string,
    email: string,
    name: string | null,
  ): Promise<typeof schema.endUsers.$inferSelect> {
    const externalId = `email:${email}`;
    const existing = await tx
      .select()
      .from(schema.endUsers)
      .where(and(eq(schema.endUsers.orgId, orgId), eq(schema.endUsers.externalId, externalId)))
      .limit(1);
    if (existing[0]) return existing[0];
    try {
      const [created] = await tx
        .insert(schema.endUsers)
        .values({
          orgId,
          externalId,
          email,
          name,
          metadata: { source: 'email-inbound' },
        })
        .returning();
      return created!;
    } catch (err) {
      const reread = await tx
        .select()
        .from(schema.endUsers)
        .where(and(eq(schema.endUsers.orgId, orgId), eq(schema.endUsers.externalId, externalId)))
        .limit(1);
      if (reread[0]) return reread[0];
      throw err;
    }
  }
}

async function encryptString(plaintext: string): Promise<string> {
  const ctx = getCurrentContext();
  const rows = await ctx.db.execute<{ ct: string } & Record<string, unknown>>(
    sql`SELECT ${encryptSecretSql(plaintext)} AS ct`,
  );
  const ct = rows[0]?.ct;
  if (!ct) throw new ConflictException('encryption_failed');
  return ct;
}

export function storedToJsonb(stored: StoredEmailChannelConfig): Record<string, unknown> {
  return JSON.parse(JSON.stringify(stored)) as Record<string, unknown>;
}

export function jsonbToStored(json: Record<string, unknown>): StoredEmailChannelConfig {
  return StoredEmailChannelConfigSchema.parse(json);
}

async function decryptString(tx: Db | Tx, ciphertext: string): Promise<string> {
  await tx.execute(setEncryptionKeySql());
  const rows = await tx.execute<{ pt: string } & Record<string, unknown>>(
    sql`SELECT ${decryptSecretSql(ciphertext)} AS pt`,
  );
  const pt = rows[0]?.pt;
  if (pt === undefined || pt === null) throw new ConflictException('decryption_failed');
  return pt;
}

async function assertReachableMailHost(role: 'SMTP' | 'IMAP', host: string): Promise<void> {
  try {
    await assertPublicHost(host);
  } catch (err) {
    if (!(err instanceof SsrfBlockedError)) throw err;
    throw new BadRequestException(`${role}: ${err.message}`);
  }
}
