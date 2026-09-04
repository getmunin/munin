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
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import {
  EmailChannelConfigInput,
  SendLimitsSchema,
  type AgentMode,
  type EmailChannelConfigInputT,
  type SendLimits,
} from '@getmunin/types';
import { findOrCreateEndUserByEmail } from '../end-user-by-email.ts';
import { parseStoredConfig, tryParseStoredConfig } from '../channels/stored-config.ts';

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
  inbound?:
    | {
        provider: 'imap';
        host: string;
        port: number;
        secure: boolean;
        username: string;
        password: typeof REDACTED_PASSWORD;
        mailbox?: string;
      }
    | {
        provider: 'relay';
        address: string;
        allowedForwarders?: string[];
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

const StoredRelayInboundSchema = z.object({
  provider: z.literal('relay'),
  address: z.string(),
  allowedForwarders: z.array(z.string()).optional(),
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
  inbound: z
    .discriminatedUnion('provider', [StoredImapInboundSchema, StoredRelayInboundSchema])
    .optional(),
  sendLimits: SendLimitsSchema.optional(),
});

export type StoredEmailChannelConfig = z.infer<typeof StoredEmailChannelConfigSchema>;

export type StoredImapInbound = z.infer<typeof StoredImapInboundSchema>;

export type StoredRelayInbound = z.infer<typeof StoredRelayInboundSchema>;

export function imapInbound(
  stored: StoredEmailChannelConfig,
): StoredImapInbound | null {
  return stored.inbound?.provider === 'imap' ? stored.inbound : null;
}

export function relayInbound(
  stored: StoredEmailChannelConfig,
): StoredRelayInbound | null {
  return stored.inbound?.provider === 'relay' ? stored.inbound : null;
}

export function readRelayDomain(): string | null {
  const raw = process.env.MUNIN_EMAIL_RELAY_DOMAIN?.trim().toLowerCase();
  return raw ? raw.replace(/^@/, '') : null;
}

export function relayInboundAvailable(): boolean {
  return readRelayDomain() !== null && !!process.env.MUNIN_EMAIL_RELAY_SECRET?.trim();
}

export function mintRelayAddress(domain: string): string {
  return `${randomBytes(8).toString('hex')}@${domain}`;
}

export function readMailerSendingDomains(): string[] {
  const raw = process.env.MUNIN_MAIL_SENDING_DOMAINS?.trim();
  if (!raw) return [];
  return raw
    .split(',')
    .map((d) => d.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean);
}

export function mailerCanSendAs(address: string): boolean {
  const allowed = readMailerSendingDomains();
  if (allowed.length === 0) return true;
  const domain = address.split('@')[1]?.trim().toLowerCase();
  if (!domain) return false;
  return allowed.some((entry) => domain === entry || domain.endsWith(`.${entry}`));
}

@Injectable()
export class EmailService {
  async toStored(input: EmailChannelConfigInputT): Promise<StoredEmailChannelConfig> {
    if (input.outbound.provider === 'smtp') {
      await assertReachableMailHost('SMTP', input.outbound.host);
    }
    if (input.outbound.provider === 'mailer' && !mailerCanSendAs(input.addressing.fromAddress)) {
      throw new BadRequestException(
        `conv_invalid: this instance cannot send as ${input.addressing.fromAddress} — shared-mailer sending is limited to ${readMailerSendingDomains().join(', ')}. Use outbound.provider "smtp" with your own credentials, or set fromAddress to a domain this instance is authorised to send as.`,
      );
    }
    if (input.inbound?.provider === 'imap') {
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
    if (input.inbound?.provider === 'imap') {
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
    } else if (input.inbound?.provider === 'relay') {
      const domain = readRelayDomain();
      if (!domain) {
        throw new BadRequestException(
          'conv_invalid: forwarding inbound is not available on this instance — MUNIN_EMAIL_RELAY_DOMAIN is not configured',
        );
      }
      out.inbound = {
        provider: 'relay',
        address: mintRelayAddress(domain),
        ...(input.inbound.allowedForwarders?.length
          ? { allowedForwarders: input.inbound.allowedForwarders.map((h) => h.toLowerCase()) }
          : {}),
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
    if (stored.inbound?.provider === 'imap') {
      out.inbound = {
        provider: 'imap',
        host: stored.inbound.host,
        port: stored.inbound.port,
        secure: stored.inbound.secure,
        username: stored.inbound.username,
        password: REDACTED_PASSWORD,
        mailbox: stored.inbound.mailbox,
      };
    } else if (stored.inbound?.provider === 'relay') {
      out.inbound = {
        provider: 'relay',
        address: stored.inbound.address,
        ...(stored.inbound.allowedForwarders?.length
          ? { allowedForwarders: [...stored.inbound.allowedForwarders] }
          : {}),
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
    if (stored.inbound?.provider === 'imap') {
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
    const wasPending = needsCredentials(stored);
    if (secrets.smtpPassword && stored.outbound.provider === 'smtp') {
      stored.outbound.encryptedPassword = await encryptString(secrets.smtpPassword);
    }
    if (secrets.imapPassword && stored.inbound?.provider === 'imap') {
      stored.inbound.encryptedPassword = await encryptString(secrets.imapPassword);
    }
    const activate = wasPending && !needsCredentials(stored);
    await ctx.db
      .update(schema.convChannels)
      .set({
        config: storedToJsonb(stored),
        ...(activate ? { active: true } : {}),
        updatedAt: new Date(),
      })
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

  async configureChannel(
    input: {
      channelId?: string;
      name: string;
      config: EmailChannelConfigInputT;
      defaultAgentMode?: AgentMode;
    },
    opts?: { rejectSecrets?: boolean },
  ): Promise<{
    id: string;
    name: string;
    type: 'email';
    active: boolean;
    config: EmailChannelConfigDto;
    defaultAgentMode: AgentMode;
  }> {
    if (input.channelId) {
      return this.updateChannel(
        {
          channelId: input.channelId,
          name: input.name,
          config: input.config,
          defaultAgentMode: input.defaultAgentMode,
        },
        opts,
      );
    }
    return this.createChannel(
      {
        name: input.name,
        config: input.config,
        defaultAgentMode: input.defaultAgentMode,
      },
      opts,
    );
  }

  async createChannel(
    input: {
      name: string;
      config: EmailChannelConfigInputT;
      defaultAgentMode?: AgentMode;
    },
    opts?: { rejectSecrets?: boolean },
  ): Promise<{
    id: string;
    name: string;
    type: 'email';
    active: boolean;
    config: EmailChannelConfigDto;
    defaultAgentMode: AgentMode;
  }> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    if (opts?.rejectSecrets) assertNoSecrets(input.config);
    const stored = await this.toStored(input.config);
    const [row] = await ctx.db
      .insert(schema.convChannels)
      .values({
        orgId: actor.orgId,
        type: 'email',
        vendor: stored.outbound.provider,
        name: input.name,
        config: storedToJsonb(stored),
        active: !needsCredentials(stored),
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

  async updateChannel(
    input: {
      channelId: string;
      name?: string;
      config: EmailChannelConfigInputT;
      defaultAgentMode?: AgentMode;
    },
    opts?: { rejectSecrets?: boolean },
  ): Promise<{
    id: string;
    name: string;
    type: 'email';
    active: boolean;
    config: EmailChannelConfigDto;
    defaultAgentMode: AgentMode;
  }> {
    const ctx = getCurrentContext();
    if (opts?.rejectSecrets) assertNoSecrets(input.config);
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
    const prev = tryJsonbToStored(channel.config);
    const merged = prev
      ? await this.mergeConfig(prev, input.config)
      : await this.toStored(input.config);
    const [row] = await ctx.db
      .update(schema.convChannels)
      .set({
        ...(input.name && { name: input.name }),
        vendor: merged.outbound.provider,
        config: storedToJsonb(merged),
        ...(needsCredentials(merged) ? { active: false } : {}),
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
      merged.inbound?.provider === 'imap' &&
      merged.inbound.encryptedPassword === '' &&
      prev.inbound?.provider === 'imap' &&
      prev.inbound.encryptedPassword
    ) {
      merged.inbound.encryptedPassword = prev.inbound.encryptedPassword;
    }
    if (merged.inbound?.provider === 'relay' && prev.inbound?.provider === 'relay') {
      merged.inbound.address = prev.inbound.address;
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
    const endUserId = await findOrCreateEndUserByEmail(
      tx,
      orgId,
      lower,
      cleanName,
      'email-inbound',
    );

    const existing = await tx
      .select()
      .from(schema.convContacts)
      .where(and(eq(schema.convContacts.orgId, orgId), eq(schema.convContacts.email, lower)))
      .limit(1);
    if (existing[0]) {
      if (existing[0].endUserId) return existing[0];
      const [patched] = await tx
        .update(schema.convContacts)
        .set({ endUserId, updatedAt: new Date() })
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
          endUserId,
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

export function needsCredentials(stored: StoredEmailChannelConfig): boolean {
  if (stored.outbound.provider === 'smtp' && !stored.outbound.encryptedPassword) return true;
  if (stored.inbound?.provider === 'imap' && !stored.inbound.encryptedPassword) return true;
  return false;
}

function assertNoSecrets(config: EmailChannelConfigInputT): void {
  const provided: string[] = [];
  if (config.outbound.provider === 'smtp' && config.outbound.password) {
    provided.push('outbound.password');
  }
  if (config.inbound?.provider === 'imap' && config.inbound.password) {
    provided.push('inbound.password');
  }
  if (provided.length > 0) {
    throw new BadRequestException(
      `conv_invalid: secret fields (${provided.join(', ')}) cannot be accepted through this tool — omit them, and a one-time credential link is returned for a human to enter them in the dashboard`,
    );
  }
}

export function storedToJsonb(stored: StoredEmailChannelConfig): Record<string, unknown> {
  return JSON.parse(JSON.stringify(stored)) as Record<string, unknown>;
}

export function jsonbToStored(json: Record<string, unknown>): StoredEmailChannelConfig {
  return parseStoredConfig(StoredEmailChannelConfigSchema, json, 'email');
}

export function tryJsonbToStored(json: Record<string, unknown>): StoredEmailChannelConfig | null {
  return tryParseStoredConfig(StoredEmailChannelConfigSchema, json);
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
