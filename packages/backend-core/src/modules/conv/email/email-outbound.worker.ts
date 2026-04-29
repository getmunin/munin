import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { schema, type Db } from '@munin/db';
import { and, eq, isNotNull, lte, lt, sql } from 'drizzle-orm';
import {
  ActorIdentity,
  WebhookDispatcher,
  withContext,
  type Mailer,
  type RequestContext,
} from '@munin/core';
import { randomUUID } from 'node:crypto';
import { createTransport, type Transporter } from 'nodemailer';
import { DB } from '../../../common/db/db.module.js';
import { MAILER } from '../../../common/mail/mail.module.js';
import {
  EmailService,
  jsonbToStored,
  type StoredEmailChannelConfig,
} from './email.service.js';
import { buildOutbound, type BuiltMessage } from './mime.js';

const POLL_INTERVAL_MS = Number(process.env.MUNIN_EMAIL_OUTBOUND_POLL_MS ?? 10_000);
const MAX_ATTEMPTS = 5;
const BATCH_SIZE = 25;
const BACKOFF_BASE_MS = 30_000;

/**
 * Drains `conv_message_deliveries` where `status='queued'` (or 'failed' with
 * `next_attempt_at <= now()`), sends the underlying message via SMTP (or
 * the configured Mailer), and writes back the outcome.
 *
 * Failure model mirrors WebhookWorker: exponential backoff with 10% jitter,
 * MAX_ATTEMPTS=5, after which the row is marked `'dead'` and a webhook
 * `conversation.message.delivery_failed` fires so an external runner can
 * notice and surface to the operator.
 *
 * Disabled in tests via `MUNIN_EMAIL_OUTBOUND_WORKER_DISABLED=1` or
 * `NODE_ENV=test`; tests call `tick()` directly.
 */
@Injectable()
export class EmailOutboundWorker implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private disabled =
    process.env.MUNIN_EMAIL_OUTBOUND_WORKER_DISABLED === '1' ||
    process.env.NODE_ENV === 'test';

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(WebhookDispatcher) private readonly webhooks: WebhookDispatcher,
    @Inject(MAILER) private readonly mailer: Mailer,
    @Inject(EmailService) private readonly emailService: EmailService,
  ) {}

  onModuleInit(): void {
    if (this.disabled) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, POLL_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Drain a batch of due deliveries. Public so tests can call directly. */
  async tick(): Promise<{ attempted: number; sent: number; failed: number }> {
    if (this.running) return { attempted: 0, sent: 0, failed: 0 };
    this.running = true;
    try {
      return await this.drain();
    } finally {
      this.running = false;
    }
  }

  private async drain(): Promise<{ attempted: number; sent: number; failed: number }> {
    const now = new Date();
    const rows = await this.db
      .select({ id: schema.convMessageDeliveries.id })
      .from(schema.convMessageDeliveries)
      .where(
        and(
          sql`${schema.convMessageDeliveries.status} IN ('queued','failed')`,
          lt(schema.convMessageDeliveries.attempt, MAX_ATTEMPTS),
          isNotNull(schema.convMessageDeliveries.nextAttemptAt),
          lte(schema.convMessageDeliveries.nextAttemptAt, now),
        ),
      )
      .limit(BATCH_SIZE);

    let sent = 0;
    let failed = 0;
    for (const row of rows) {
      const ok = await this.attemptOne(row.id);
      if (ok) sent += 1;
      else failed += 1;
    }
    return { attempted: rows.length, sent, failed };
  }

  private async attemptOne(deliveryId: string): Promise<boolean> {
    // Load delivery + message + conversation + channel + contact in one tx,
    // and grab the next outbound's threading anchors.
    const ctx = await this.loadContext(deliveryId);
    if (!ctx) return false;

    const config = jsonbToStored(ctx.channel.config);
    const recipient = ctx.contact?.email ?? extractToFromMetadata(ctx.message.metadata);
    if (!recipient) {
      await this.recordFailure(deliveryId, ctx.attempt, 'no recipient on conversation contact');
      return false;
    }

    let built: BuiltMessage;
    try {
      built = buildOutbound({
        from: composeFrom(config.addressing.fromName, config.addressing.fromAddress),
        to: recipient,
        replyTo: this.composeReplyTo(config, ctx.conversation.id),
        subject: ctx.conversation.subject?.trim() || `Re: ${ctx.conversation.id}`,
        text: ctx.message.body,
        html: ctx.message.bodyHtml ?? undefined,
        messageIdDomain: config.addressing.fromAddress,
        inReplyTo: ctx.delivery.inReplyToHeader ?? undefined,
        references: ctx.delivery.inReplyToHeader ? [ctx.delivery.inReplyToHeader] : undefined,
      });
    } catch (err) {
      await this.recordFailure(deliveryId, ctx.attempt, errorMessage(err));
      return false;
    }

    try {
      await this.dispatch(config, built, recipient, ctx.channel.id);
    } catch (err) {
      await this.recordFailure(deliveryId, ctx.attempt, errorMessage(err));
      return false;
    }

    await this.db
      .update(schema.convMessageDeliveries)
      .set({
        status: 'sent',
        attempt: ctx.attempt + 1,
        sentAt: new Date(),
        messageIdHeader: built.messageId,
        error: null,
        nextAttemptAt: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.convMessageDeliveries.id, deliveryId));

    await this.fireWebhook('conversation.message.delivered', {
      orgId: ctx.message.orgId,
      conversationId: ctx.conversation.id,
      messageId: ctx.message.id,
      channelId: ctx.channel.id,
    });
    return true;
  }

  private async dispatch(
    config: StoredEmailChannelConfig,
    built: BuiltMessage,
    to: string,
    channelId: string,
  ): Promise<void> {
    if (config.outbound.provider === 'smtp') {
      const password = await this.db.transaction(async (tx) => {
        return this.emailService.decryptSmtpPassword(
          tx,
          config.outbound.provider === 'smtp' ? config.outbound.encryptedPassword : '',
        );
      });
      const transport: Transporter = createTransport({
        host: config.outbound.host,
        port: config.outbound.port,
        secure: config.outbound.secure,
        auth: { user: config.outbound.username, pass: password },
      });
      await transport.sendMail({
        envelope: { from: config.addressing.fromAddress, to },
        raw: built.raw,
      });
      transport.close();
      return;
    }
    // Mailer fallback (Resend / Stub) — extract text from the MIME we built.
    // Since the Mailer doesn't take raw MIME, we hand it the plain text +
    // headers so threading still works at the Resend layer.
    await this.mailer.send({
      from: composeFrom(config.addressing.fromName, config.addressing.fromAddress),
      to,
      subject: extractSubject(built.raw) ?? 'Munin message',
      text: extractTextBody(built.raw),
      replyTo: this.composeReplyToBare(config, channelId),
      headers: {
        'Message-ID': `<${built.messageId}>`,
      },
    });
  }

  private composeReplyTo(config: StoredEmailChannelConfig, conversationId: string): string | undefined {
    if (config.addressing.replyToTemplate) {
      return config.addressing.replyToTemplate.replace('{conversationId}', conversationId);
    }
    const replyDomain = process.env.MUNIN_EMAIL_REPLY_DOMAIN;
    if (!replyDomain) return undefined;
    const local = config.addressing.fromAddress.split('@')[0] ?? 'support';
    return `${local}+conv-${conversationId}@${replyDomain}`;
  }

  private composeReplyToBare(config: StoredEmailChannelConfig, channelId: string): string | undefined {
    void channelId;
    return config.addressing.replyToTemplate ?? undefined;
  }

  private async recordFailure(
    deliveryId: string,
    priorAttempts: number,
    error: string,
  ): Promise<void> {
    const next = priorAttempts + 1;
    const final = next >= MAX_ATTEMPTS;
    const backoff = BACKOFF_BASE_MS * 2 ** priorAttempts;
    const jitter = Math.floor(backoff * 0.1 * Math.random());
    await this.db
      .update(schema.convMessageDeliveries)
      .set({
        status: final ? 'dead' : 'failed',
        attempt: next,
        error,
        nextAttemptAt: final ? null : new Date(Date.now() + backoff + jitter),
        updatedAt: new Date(),
      })
      .where(eq(schema.convMessageDeliveries.id, deliveryId));

    if (final) {
      const row = await this.db
        .select()
        .from(schema.convMessageDeliveries)
        .where(eq(schema.convMessageDeliveries.id, deliveryId))
        .limit(1);
      const d = row[0];
      if (d) {
        const msg = await this.db
          .select({ conversationId: schema.convMessages.conversationId })
          .from(schema.convMessages)
          .where(eq(schema.convMessages.id, d.messageId))
          .limit(1);
        await this.fireWebhook('conversation.message.delivery_failed', {
          orgId: d.orgId,
          conversationId: msg[0]?.conversationId ?? '',
          messageId: d.messageId,
          channelId: d.channelId,
          error,
          attempts: next,
        });
      }
    }
  }

  private async fireWebhook(
    type: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const orgId = payload.orgId as string;
    if (!orgId) return;
    const actor = new ActorIdentity('system', 'email-outbound-worker', orgId, ['*'], ['admin']);
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`);
      const ctx: RequestContext = {
        db: tx,
        actor,
        correlationId: randomUUID(),
      };
      await withContext(ctx, async () => {
        await this.webhooks.emit({ type, payload });
      });
    });
  }

  private async loadContext(deliveryId: string): Promise<{
    delivery: typeof schema.convMessageDeliveries.$inferSelect;
    message: typeof schema.convMessages.$inferSelect;
    conversation: typeof schema.convConversations.$inferSelect;
    channel: typeof schema.convChannels.$inferSelect;
    contact: typeof schema.convContacts.$inferSelect | null;
    attempt: number;
  } | null> {
    const rows = await this.db
      .select({
        delivery: schema.convMessageDeliveries,
        message: schema.convMessages,
        conversation: schema.convConversations,
        channel: schema.convChannels,
        contact: schema.convContacts,
      })
      .from(schema.convMessageDeliveries)
      .innerJoin(
        schema.convMessages,
        eq(schema.convMessages.id, schema.convMessageDeliveries.messageId),
      )
      .innerJoin(
        schema.convConversations,
        eq(schema.convConversations.id, schema.convMessages.conversationId),
      )
      .innerJoin(
        schema.convChannels,
        eq(schema.convChannels.id, schema.convMessageDeliveries.channelId),
      )
      .leftJoin(
        schema.convContacts,
        eq(schema.convContacts.id, schema.convConversations.contactId),
      )
      .where(eq(schema.convMessageDeliveries.id, deliveryId))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      delivery: row.delivery,
      message: row.message,
      conversation: row.conversation,
      channel: row.channel,
      contact: row.contact ?? null,
      attempt: row.delivery.attempt,
    };
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function composeFrom(name: string | undefined, address: string): string {
  if (!name) return address;
  // Strip quotes / commas the user might paste in to avoid header injection.
  const clean = name.replace(/[",\r\n]/g, '').trim();
  return `${clean} <${address}>`;
}

function extractToFromMetadata(metadata: Record<string, unknown>): string | null {
  const v = (metadata as { recipient?: unknown }).recipient;
  return typeof v === 'string' ? v : null;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function extractSubject(raw: string): string | null {
  const m = raw.match(/^Subject:\s*(.+)$/m);
  return m?.[1]?.trim() ?? null;
}

function extractTextBody(raw: string): string {
  const split = raw.indexOf('\r\n\r\n');
  if (split < 0) return '';
  return raw.slice(split + 4);
}
