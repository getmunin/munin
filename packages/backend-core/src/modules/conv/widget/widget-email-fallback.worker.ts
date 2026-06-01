import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { schema, type Db } from '@getmunin/db';
import { and, eq, sql } from 'drizzle-orm';
import { createTransport, type Transporter } from 'nodemailer';
import { resolvePublicHost, type Mailer } from '@getmunin/core';
import { DB } from '../../../common/db/db.module.ts';
import { MAILER } from '../../../common/mail/mail.module.ts';
import { EmailService, jsonbToStored, type StoredEmailChannelConfig } from '../email/email.service.ts';
import { smtpTransportOptions } from '../email/email.tools.ts';
import { buildOutbound, type BuiltMessage } from '../email/mime.ts';
import {
  formatQuotedHistory,
  loadPriorMessagesForQuote,
  type QuotedPriorMessage,
} from '../email/reply-history.ts';

const DEFAULT_INTERVAL_MS = 60_000;
const DEFAULT_THRESHOLD_MS = 10 * 60_000;
const CANDIDATE_BATCH_SIZE = 50;

type CandidateRow = {
  conversation_id: string;
  org_id: string;
  end_user_id: string;
  email_channel_id: string;
  end_user_email: string;
  end_user_name: string | null;
  conv_created_at: Date | string;
  conv_subject: string | null;
} & Record<string, unknown>;

type UnreadRow = {
  id: string;
  body: string;
  body_html: string | null;
  author_type: string;
  author_id: string;
  created_at: Date | string;
} & Record<string, unknown>;

@Injectable()
export class WidgetEmailFallbackWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WidgetEmailFallbackWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly disabled =
    process.env.MUNIN_WIDGET_EMAIL_FALLBACK_DISABLED === '1' ||
    process.env.NODE_ENV === 'test';
  private readonly intervalMs = Number(
    process.env.MUNIN_WIDGET_EMAIL_FALLBACK_INTERVAL_MS ?? DEFAULT_INTERVAL_MS,
  );
  private readonly thresholdMs = Number(
    process.env.MUNIN_WIDGET_EMAIL_FALLBACK_THRESHOLD_MS ?? DEFAULT_THRESHOLD_MS,
  );

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(MAILER) private readonly mailer: Mailer,
    @Inject(EmailService) private readonly emailService: EmailService,
  ) {}

  onModuleInit(): void {
    if (this.disabled) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, this.intervalMs);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<{ scanned: number; sent: number; skipped: number; failed: number }> {
    if (this.running) return { scanned: 0, sent: 0, skipped: 0, failed: 0 };
    this.running = true;
    try {
      return await this.sweep();
    } catch (err) {
      this.logger.warn(`sweep failed: ${describeError(err)}`);
      return { scanned: 0, sent: 0, skipped: 0, failed: 0 };
    } finally {
      this.running = false;
    }
  }

  private async sweep(): Promise<{
    scanned: number;
    sent: number;
    skipped: number;
    failed: number;
  }> {
    const cutoff = new Date(Date.now() - this.thresholdMs);
    const candidates = await this.findCandidates(cutoff);

    let sent = 0;
    let skipped = 0;
    let failed = 0;
    for (const cand of candidates) {
      try {
        const outcome = await this.processOne(cand);
        if (outcome === 'sent') sent += 1;
        else if (outcome === 'skipped') skipped += 1;
        else failed += 1;
      } catch (err) {
        failed += 1;
        this.logger.warn(
          `fallback for conversation ${cand.conversation_id} failed: ${describeError(err)}`,
        );
      }
    }
    return { scanned: candidates.length, sent, skipped, failed };
  }

  private async findCandidates(cutoff: Date): Promise<CandidateRow[]> {
    const rows = await this.db.execute<CandidateRow>(sql`
      SELECT
        c.id AS conversation_id,
        c.org_id,
        c.end_user_id,
        ec.id AS email_channel_id,
        eu.email AS end_user_email,
        eu.name AS end_user_name,
        c.created_at AS conv_created_at,
        c.subject AS conv_subject
      FROM conv_conversations c
      JOIN conv_channels ch ON ch.id = c.channel_id
      JOIN end_users eu ON eu.id = c.end_user_id
      JOIN LATERAL (
        SELECT id FROM conv_channels
        WHERE org_id = c.org_id
          AND type = 'email'
          AND active = true
          AND archived_at IS NULL
        ORDER BY created_at ASC
        LIMIT 1
      ) ec ON TRUE
      WHERE ch.type = 'chat'
        AND c.end_user_id IS NOT NULL
        AND eu.email IS NOT NULL
        AND eu.email <> ''
        AND EXISTS (
          SELECT 1 FROM conv_messages m
          WHERE m.conversation_id = c.id
            AND m.author_type <> 'end_user'
            AND m.internal = false
            AND m.created_at <= ${cutoff.toISOString()}::timestamptz
            AND NOT EXISTS (
              SELECT 1 FROM conv_message_reads r
              WHERE r.message_id = m.id AND r.end_user_id = c.end_user_id
            )
            AND NOT EXISTS (
              SELECT 1 FROM conv_message_deliveries d
              WHERE d.message_id = m.id
            )
        )
      ORDER BY c.last_message_at ASC NULLS LAST
      LIMIT ${CANDIDATE_BATCH_SIZE}
    `);
    return toArray(rows);
  }

  private async processOne(cand: CandidateRow): Promise<'sent' | 'skipped' | 'failed'> {
    const engagement = await this.computeLastEngagement(cand);
    const unread = await this.loadUnread(cand.conversation_id, cand.end_user_id);
    if (unread.length === 0) return 'skipped';
    const trigger = unread[0]!;

    const claimed = await this.db
      .insert(schema.convWidgetEmailFallbacks)
      .values({
        orgId: cand.org_id,
        conversationId: cand.conversation_id,
        endUserId: cand.end_user_id,
        emailChannelId: cand.email_channel_id,
        triggerMessageId: trigger.id,
        lastEngagementAt: engagement,
        messageCount: unread.length,
        status: 'queued',
      })
      .onConflictDoNothing({
        target: [
          schema.convWidgetEmailFallbacks.conversationId,
          schema.convWidgetEmailFallbacks.lastEngagementAt,
        ],
      })
      .returning({ id: schema.convWidgetEmailFallbacks.id });
    const fallbackId = claimed[0]?.id;
    if (!fallbackId) return 'skipped';

    const stillUnread = await this.loadUnread(cand.conversation_id, cand.end_user_id);
    if (stillUnread.length === 0) {
      await this.markStatus(fallbackId, 'cancelled', null);
      return 'skipped';
    }

    const channel = await this.loadEmailChannel(cand.email_channel_id);
    if (!channel) {
      await this.markStatus(fallbackId, 'failed', 'email channel missing');
      return 'failed';
    }
    let config: StoredEmailChannelConfig;
    try {
      config = jsonbToStored(channel.config);
    } catch (err) {
      await this.markStatus(fallbackId, 'failed', `invalid email channel config: ${describeError(err)}`);
      return 'failed';
    }

    const replyTo = this.composeReplyTo(config, cand.conversation_id);
    const latestUnread = stillUnread[stillUnread.length - 1]!;
    const channelFromName = (config.addressing.fromName ?? '').trim() || 'Support';
    let prior: QuotedPriorMessage[];
    try {
      prior = await loadPriorMessagesForQuote(this.db, {
        conversationId: cand.conversation_id,
        excludeMessageId: latestUnread.id,
        contactName: cand.end_user_name,
        contactEmail: cand.end_user_email,
        channelFromName,
        limit: 3,
      });
    } catch (err) {
      await this.markStatus(fallbackId, 'failed', `quote-history load failed: ${describeError(err)}`);
      return 'failed';
    }

    let signoffName: string;
    try {
      signoffName = await this.resolveSignoffName(cand.org_id, latestUnread, channelFromName);
    } catch (err) {
      await this.markStatus(fallbackId, 'failed', `signoff resolution failed: ${describeError(err)}`);
      return 'failed';
    }

    let built: BuiltMessage;
    try {
      built = this.buildDigest({
        config,
        replyTo,
        subject: cand.conv_subject,
        recipientEmail: cand.end_user_email,
        recipientName: cand.end_user_name,
        latest: latestUnread,
        prior,
        signoffName,
      });
    } catch (err) {
      await this.markStatus(fallbackId, 'failed', `digest build failed: ${describeError(err)}`);
      return 'failed';
    }

    try {
      await this.send(config, cand.end_user_email, replyTo, built);
    } catch (err) {
      await this.markStatus(fallbackId, 'failed', describeError(err));
      return 'failed';
    }

    await this.db.transaction(async (tx) => {
      await tx
        .update(schema.convWidgetEmailFallbacks)
        .set({
          status: 'sent',
          sentAt: new Date(),
          messageIdHeader: built.messageId,
          updatedAt: new Date(),
        })
        .where(eq(schema.convWidgetEmailFallbacks.id, fallbackId));

      const deliveryRows = stillUnread.map((m) => ({
        orgId: cand.org_id,
        messageId: m.id,
        channelId: cand.email_channel_id,
        status: 'sent',
        attempt: 1,
        sentAt: new Date(),
        messageIdHeader: built.messageId,
      }));
      if (deliveryRows.length > 0) {
        await tx.insert(schema.convMessageDeliveries).values(deliveryRows);
      }
    });

    return 'sent';
  }

  private async computeLastEngagement(cand: CandidateRow): Promise<Date> {
    const rows = await this.db.execute<{ engagement_at: Date | string } & Record<string, unknown>>(sql`
      SELECT GREATEST(
        ${asTimestamp(cand.conv_created_at)},
        COALESCE((
          SELECT MAX(m.created_at) FROM conv_messages m
          WHERE m.conversation_id = ${cand.conversation_id}
            AND m.author_type = 'end_user'
        ), ${asTimestamp(cand.conv_created_at)}),
        COALESCE((
          SELECT MAX(r.read_at) FROM conv_message_reads r
          WHERE r.conversation_id = ${cand.conversation_id}
            AND r.end_user_id = ${cand.end_user_id}
        ), ${asTimestamp(cand.conv_created_at)})
      ) AS engagement_at
    `);
    const row = toArray<{ engagement_at: Date | string }>(rows)[0];
    if (!row) return toDate(cand.conv_created_at);
    return toDate(row.engagement_at);
  }

  private async loadUnread(conversationId: string, endUserId: string): Promise<UnreadRow[]> {
    const cutoff = new Date(Date.now() - this.thresholdMs);
    const rows = await this.db.execute<UnreadRow>(sql`
      SELECT m.id, m.body, m.body_html, m.author_type, m.author_id, m.created_at
      FROM conv_messages m
      WHERE m.conversation_id = ${conversationId}
        AND m.author_type <> 'end_user'
        AND m.internal = false
        AND m.created_at <= ${cutoff.toISOString()}::timestamptz
        AND NOT EXISTS (
          SELECT 1 FROM conv_message_reads r
          WHERE r.message_id = m.id AND r.end_user_id = ${endUserId}
        )
        AND NOT EXISTS (
          SELECT 1 FROM conv_message_deliveries d
          WHERE d.message_id = m.id
        )
      ORDER BY m.created_at ASC
    `);
    return toArray(rows);
  }

  private async loadEmailChannel(
    channelId: string,
  ): Promise<typeof schema.convChannels.$inferSelect | null> {
    const rows = await this.db
      .select()
      .from(schema.convChannels)
      .where(
        and(
          eq(schema.convChannels.id, channelId),
          eq(schema.convChannels.active, true),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  private async markStatus(
    fallbackId: string,
    status: 'failed' | 'cancelled',
    error: string | null,
  ): Promise<void> {
    await this.db
      .update(schema.convWidgetEmailFallbacks)
      .set({ status, error, updatedAt: new Date() })
      .where(eq(schema.convWidgetEmailFallbacks.id, fallbackId));
  }

  private async resolveSignoffName(
    orgId: string,
    latest: UnreadRow,
    channelFromName: string,
  ): Promise<string> {
    if (latest.author_type === 'user' && latest.author_id) {
      const [u] = await this.db
        .select({ name: schema.users.name })
        .from(schema.users)
        .where(eq(schema.users.id, latest.author_id))
        .limit(1);
      const first = firstWord(u?.name);
      if (first) return first;
      return channelFromName;
    }
    if (latest.author_type === 'agent') {
      const [a] = await this.db
        .select({ name: schema.assistants.name })
        .from(schema.assistants)
        .where(eq(schema.assistants.orgId, orgId))
        .limit(1);
      const trimmed = a?.name?.trim();
      if (trimmed) return trimmed;
      return channelFromName;
    }
    return channelFromName;
  }

  private buildDigest(params: {
    config: StoredEmailChannelConfig;
    replyTo: string | undefined;
    subject: string | null;
    recipientEmail: string;
    recipientName: string | null;
    latest: UnreadRow;
    prior: QuotedPriorMessage[];
    signoffName: string;
  }): BuiltMessage {
    const { config, replyTo, recipientEmail, recipientName, latest, prior, signoffName } = params;
    const fromName = (config.addressing.fromName ?? '').trim() || 'Support';
    const subject = params.subject?.trim() || `New message from ${fromName}`;

    const latestBody = stripHtml(latest.body).trim() || '(no message)';
    const quoted = formatQuotedHistory(prior, 3);
    const sections = [latestBody, `— ${signoffName}`];
    if (quoted) sections.push(quoted);
    const text = sections.join('\n\n');

    return buildOutbound({
      from: composeFrom(config.addressing.fromName, config.addressing.fromAddress),
      to: composeFrom(recipientName ?? undefined, recipientEmail),
      replyTo,
      subject,
      text,
      messageIdDomain: config.addressing.fromAddress,
    });
  }

  private composeReplyTo(
    config: StoredEmailChannelConfig,
    conversationId: string,
  ): string | undefined {
    if (config.addressing.replyToTemplate) {
      return config.addressing.replyToTemplate.replace('{conversationId}', conversationId);
    }
    const replyDomain = process.env.MUNIN_EMAIL_REPLY_DOMAIN;
    if (!replyDomain) return undefined;
    const local = config.addressing.fromAddress.split('@')[0] ?? 'support';
    return `${local}+conv-${conversationId}@${replyDomain}`;
  }

  private async send(
    config: StoredEmailChannelConfig,
    recipient: string,
    replyTo: string | undefined,
    built: BuiltMessage,
  ): Promise<void> {
    if (config.outbound.provider === 'smtp') {
      const resolved = await resolvePublicHost(config.outbound.host);
      const password = await this.db.transaction((tx) =>
        this.emailService.decryptSmtpPassword(
          tx,
          config.outbound.provider === 'smtp' ? config.outbound.encryptedPassword : '',
        ),
      );
      const transport: Transporter = createTransport(
        smtpTransportOptions(
          config.outbound.host,
          config.outbound.port,
          config.outbound.secure,
          { user: config.outbound.username, pass: password },
          resolved?.address,
        ),
      );
      try {
        await transport.sendMail({
          envelope: { from: config.addressing.fromAddress, to: recipient },
          raw: built.raw,
        });
      } finally {
        transport.close();
      }
    } else {
      await this.mailer.send({
        from: composeFrom(config.addressing.fromName, config.addressing.fromAddress),
        to: recipient,
        subject: extractSubject(built.raw) ?? 'New message',
        text: extractTextBody(built.raw),
        replyTo,
        headers: { 'Message-ID': `<${built.messageId}>` },
      });
    }
  }
}

function firstWord(name: string | null | undefined): string | null {
  const trimmed = name?.trim();
  if (!trimmed) return null;
  return trimmed.split(/\s+/)[0]!;
}

function composeFrom(name: string | undefined, address: string): string {
  if (!name) return address;
  const clean = name.replace(/[",\r\n]/g, '').trim();
  return `${clean} <${address}>`;
}

function stripHtml(input: string): string {
  return input
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function toArray<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const rows = (result as { rows?: unknown[] }).rows;
  return Array.isArray(rows) ? (rows as T[]) : [];
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function asTimestamp(value: Date | string): ReturnType<typeof sql> {
  const iso = (value instanceof Date ? value : new Date(value)).toISOString();
  return sql`${iso}::timestamptz`;
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

