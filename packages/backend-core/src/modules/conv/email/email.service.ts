import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { schema, type Db, type Tx } from '@getmunin/db';
import { and, desc, eq, isNotNull, sql } from 'drizzle-orm';
import {
  decryptSecretSql,
  encryptSecretSql,
  getCurrentContext,
  setEncryptionKeySql,
} from '@getmunin/core';
import { z } from 'zod';
import {
  EmailChannelConfigInput,
  type EmailChannelConfigInputT,
} from '@getmunin/types';

export { EmailChannelConfigInput };
export type { EmailChannelConfigInputT };

const REDACTED_PASSWORD = '••••';

// ─── DTO shapes the dashboard / agents see (passwords redacted) ──────────

export interface EmailChannelConfigDto {
  addressing: {
    fromAddress: string;
    fromName?: string;
    replyToTemplate?: string;
  };
  outbound:
    | { provider: 'mailer' }
    | {
        provider: 'smtp';
        host: string;
        port: number;
        secure: boolean;
        username: string;
        password: typeof REDACTED_PASSWORD;
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
}

// ─── Internal stored shape (passwords are pgcrypto envelopes) ─────────────

const StoredSmtpOutboundSchema = z.object({
  provider: z.literal('smtp'),
  host: z.string(),
  port: z.number().int(),
  secure: z.boolean(),
  username: z.string(),
  encryptedPassword: z.string(),
});

const StoredMailerOutboundSchema = z.object({
  provider: z.literal('mailer'),
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
});

export type StoredEmailChannelConfig = z.infer<typeof StoredEmailChannelConfigSchema>;

@Injectable()
export class EmailService {
  /**
   * Encrypt the SMTP / IMAP passwords from a user-supplied config and return
   * the storable shape. The encryption is round-tripped through pgcrypto so
   * we never have an AES key in app memory; the request transaction has
   * already SET LOCAL `app.crypt_key` (TenancyInterceptor or worker setup).
   */
  async toStored(input: EmailChannelConfigInputT): Promise<StoredEmailChannelConfig> {
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
            }
          : { provider: 'mailer' },
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
    return out;
  }

  /** Project the stored config into the dashboard-safe DTO (passwords redacted). */
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
            }
          : { provider: 'mailer' },
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
    return out;
  }

  /**
   * Decrypt the SMTP password (only). Used by the outbound worker right
   * before it builds + sends a message. Pass the worker's transaction `tx`
   * because the worker runs outside the request-context interceptor and
   * needs to set its own crypt-key GUC.
   */
  async decryptSmtpPassword(tx: Db | Tx, encryptedPassword: string): Promise<string> {
    if (!encryptedPassword) return '';
    return decryptString(tx, encryptedPassword);
  }

  /** Same shape, for IMAP. */
  async decryptImapPassword(tx: Db | Tx, encryptedPassword: string): Promise<string> {
    if (!encryptedPassword) return '';
    return decryptString(tx, encryptedPassword);
  }

  /**
   * Persist a brand-new email channel for the calling org. Used by the
   * `conv_email_setup_channel` MCP tool. Validates the config, encrypts
   * passwords, returns the channel row + redacted DTO.
   */
  async createChannel(input: { name: string; config: EmailChannelConfigInputT }): Promise<{
    id: string;
    name: string;
    type: 'email';
    active: boolean;
    config: EmailChannelConfigDto;
  }> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const stored = await this.toStored(input.config);
    const [row] = await ctx.db
      .insert(schema.convChannels)
      .values({
        orgId: actor.orgId,
        type: 'email',
        name: input.name,
        config: storedToJsonb(stored),
      })
      .returning();
    return {
      id: row!.id,
      name: row!.name,
      type: 'email',
      active: row!.active,
      config: this.toDto(stored),
    };
  }

  /**
   * Update an existing email channel's config. Empty plaintext passwords
   * mean "leave the encrypted password as-is" (so re-saving the dashboard
   * form doesn't blank the credentials).
   */
  async updateChannel(input: {
    channelId: string;
    name?: string;
    config: EmailChannelConfigInputT;
  }): Promise<{
    id: string;
    name: string;
    type: 'email';
    active: boolean;
    config: EmailChannelConfigDto;
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
        config: storedToJsonb(merged),
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
    };
  }

  /** Merge an update over a stored config, preserving prior encrypted creds when the input omits them. */
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

  /**
   * Look up the most-recent successful outbound delivery for a conversation
   * to chain `In-Reply-To` from. Used by `enqueueOutbound`.
   */
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

  /**
   * Insert a `conv_message_deliveries` row for a freshly-created outbound
   * message on an email channel. Stamps `in_reply_to_header` from the
   * most-recent successful outbound on the same conversation so reply
   * chains hold.
   */
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

  /**
   * Find or create a `conv_contacts` row by `(orgId, email)`. Used by the
   * inbound worker when it sees a sender we don't already have a contact
   * for. Idempotent on concurrent calls (race-tolerant via re-check).
   */
  async findOrCreateContactByEmail(
    tx: Db | Tx,
    orgId: string,
    email: string,
    name?: string,
  ): Promise<typeof schema.convContacts.$inferSelect> {
    const lower = email.trim().toLowerCase();
    const existing = await tx
      .select()
      .from(schema.convContacts)
      .where(and(eq(schema.convContacts.orgId, orgId), eq(schema.convContacts.email, lower)))
      .limit(1);
    if (existing[0]) return existing[0];
    try {
      const [row] = await tx
        .insert(schema.convContacts)
        .values({
          orgId,
          email: lower,
          name: name?.trim() || null,
          metadata: {},
        })
        .returning();
      return row!;
    } catch (err) {
      // Concurrent insert — re-read.
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

// ─── pgcrypto wrappers — write / read encrypted strings ─────────────────────

/**
 * Encrypt a plaintext using pgp_sym_encrypt + the per-tx key. Pulls the
 * Db from the request context so the call site doesn't need to thread it.
 */
async function encryptString(plaintext: string): Promise<string> {
  const ctx = getCurrentContext();
  const rows = await ctx.db.execute<{ ct: string } & Record<string, unknown>>(
    sql`SELECT ${encryptSecretSql(plaintext)} AS ct`,
  );
  const ct = rows[0]?.ct;
  if (!ct) throw new ConflictException('encryption_failed');
  return ct;
}

/**
 * Convert a typed channel-config to the loose jsonb shape drizzle's column
 * type expects (`Record<string, unknown>`). It's a deep copy via JSON, which
 * also normalizes anything non-JSONable (none, today — but a safe boundary).
 */
export function storedToJsonb(stored: StoredEmailChannelConfig): Record<string, unknown> {
  return JSON.parse(JSON.stringify(stored)) as Record<string, unknown>;
}

/**
 * Inverse: read the loose jsonb back as the typed config. Validates with the
 * stored Zod schema — guards against shape drift (e.g. an older row written
 * before a schema change).
 */
export function jsonbToStored(json: Record<string, unknown>): StoredEmailChannelConfig {
  return StoredEmailChannelConfigSchema.parse(json);
}

async function decryptString(tx: Db | Tx, ciphertext: string): Promise<string> {
  // Worker callers may not have the GUC set on this transaction; set it.
  await tx.execute(setEncryptionKeySql());
  const rows = await tx.execute<{ pt: string } & Record<string, unknown>>(
    sql`SELECT ${decryptSecretSql(ciphertext)} AS pt`,
  );
  const pt = rows[0]?.pt;
  if (pt === undefined || pt === null) throw new ConflictException('decryption_failed');
  return pt;
}
