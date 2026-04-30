import { Inject, Injectable } from '@nestjs/common';
import { schema, type Db } from '@getmunin/db';
import { eq, sql } from 'drizzle-orm';
import {
  ActorIdentity,
  WebhookDispatcher,
  withContext,
  type Mailer,
  type RequestContext,
} from '@getmunin/core';
import { ImapFlow } from 'imapflow';
import { simpleParser, type ParsedMail, type AddressObject } from 'mailparser';
import { randomUUID } from 'node:crypto';
import { createTransport, type Transporter } from 'nodemailer';
import { DB } from '../../../common/db/db.module.js';
import { MAILER } from '../../../common/mail/mail.module.js';
import {
  EmailService,
  jsonbToStored,
  type StoredEmailChannelConfig,
} from './email.service.js';
import { buildOutbound, stripMessageIdBrackets, parseMessageIdHeader, type BuiltMessage } from './mime.js';
import { resolveInbound, type ParsedInboundEmail } from './threading.js';
import type {
  ChannelAdapter,
  ChannelRow,
  InboundMode,
  PollTickResult,
  SendContext,
  SendResult,
} from '../channels/adapter.js';

const POLL_INTERVAL_MS = Number(process.env.MUNIN_EMAIL_INBOUND_POLL_MS ?? 60_000);
const MAX_MESSAGES_PER_TICK = 100;

interface ImapMessageMin {
  uid: number;
  source: Buffer | string;
}

/** IMAP fetcher boundary. Tests inject a stub; production uses imapflow. */
export interface ImapFetcher {
  fetchSince(opts: {
    host: string;
    port: number;
    secure: boolean;
    username: string;
    password: string;
    mailbox: string;
    sinceUid: number | null;
    limit: number;
  }): Promise<ImapMessageMin[]>;
}

class ImapFlowFetcher implements ImapFetcher {
  async fetchSince(opts: {
    host: string;
    port: number;
    secure: boolean;
    username: string;
    password: string;
    mailbox: string;
    sinceUid: number | null;
    limit: number;
  }): Promise<ImapMessageMin[]> {
    const client = new ImapFlow({
      host: opts.host,
      port: opts.port,
      secure: opts.secure,
      auth: { user: opts.username, pass: opts.password },
      logger: false,
    });
    await client.connect();
    try {
      await client.mailboxOpen(opts.mailbox);
      const range = opts.sinceUid ? `${opts.sinceUid + 1}:*` : '1:*';
      const out: ImapMessageMin[] = [];
      for await (const msg of client.fetch(range, { uid: true, source: true })) {
        if (!msg.source) continue;
        out.push({ uid: msg.uid, source: msg.source });
        if (out.length >= opts.limit) break;
      }
      return out;
    } finally {
      await client.logout().catch(() => {});
    }
  }
}

/**
 * Email adapter — IMAP poll inbound, SMTP/Mailer outbound. Behavior matches
 * the prior `EmailInboundWorker` + `EmailOutboundWorker.attemptOne` — they
 * are now thin wrappers over this adapter via `InboundPollWorker` and
 * `OutboundDeliveryWorker`.
 */
@Injectable()
export class EmailAdapter implements ChannelAdapter {
  readonly kind = 'email' as const;

  private fetcher: ImapFetcher = new ImapFlowFetcher();

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(WebhookDispatcher) private readonly webhooks: WebhookDispatcher,
    @Inject(MAILER) private readonly mailer: Mailer,
    @Inject(EmailService) private readonly emailService: EmailService,
  ) {}

  /** Test-only: swap the IMAP boundary. */
  setFetcher(f: ImapFetcher): void {
    this.fetcher = f;
  }

  readonly inbound: InboundMode = {
    mode: 'poll',
    intervalMs: POLL_INTERVAL_MS,
    tick: (channel) => this.pollOne(channel),
  };

  async send(ctx: SendContext): Promise<SendResult> {
    const config = jsonbToStored(ctx.channel.config);
    const recipient = ctx.contact?.email ?? extractToFromMetadata(ctx.message.metadata);
    if (!recipient) throw new Error('no recipient on conversation contact');

    const built: BuiltMessage = buildOutbound({
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
        envelope: { from: config.addressing.fromAddress, to: recipient },
        raw: built.raw,
      });
      transport.close();
    } else {
      // Mailer fallback (Resend / Stub).
      await this.mailer.send({
        from: composeFrom(config.addressing.fromName, config.addressing.fromAddress),
        to: recipient,
        subject: extractSubject(built.raw) ?? 'Munin message',
        text: extractTextBody(built.raw),
        replyTo: config.addressing.replyToTemplate ?? undefined,
        headers: {
          'Message-ID': `<${built.messageId}>`,
        },
      });
    }

    return { providerMessageId: built.messageId };
  }

  // ─── inbound poll ───────────────────────────────────────────────────────

  private async pollOne(channel: ChannelRow): Promise<PollTickResult> {
    const config = jsonbToStored(channel.config);
    if (!config.inbound) return { messagesIngested: 0 };

    const cursor = await this.readCursor(channel.id);
    const sinceUid = typeof cursor.lastUid === 'number' ? cursor.lastUid : null;

    const password = await this.db.transaction((tx) =>
      this.emailService.decryptImapPassword(tx, config.inbound!.encryptedPassword),
    );

    const messages = await this.fetcher.fetchSince({
      host: config.inbound.host,
      port: config.inbound.port,
      secure: config.inbound.secure,
      username: config.inbound.username,
      password,
      mailbox: config.inbound.mailbox ?? 'INBOX',
      sinceUid,
      limit: MAX_MESSAGES_PER_TICK,
    });

    if (messages.length === 0) {
      await this.writeCursor(channel.id, { lastUid: sinceUid ?? null }, null);
      return { messagesIngested: 0 };
    }

    let highWater = sinceUid ?? 0;
    let ingested = 0;
    let lastError: string | null = null;
    for (const msg of messages) {
      try {
        const parsed = await parseMessage(msg.source);
        await this.ingest(channel, parsed);
        ingested += 1;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
      }
      if (msg.uid > highWater) highWater = msg.uid;
    }
    await this.writeCursor(channel.id, { lastUid: highWater }, lastError);
    return { messagesIngested: ingested, lastError };
  }

  private async ingest(channel: ChannelRow, parsed: ParsedInboundEmail): Promise<void> {
    if (!parsed.fromAddress) return;
    const orgId = channel.orgId;
    const replyDomain = process.env.MUNIN_EMAIL_REPLY_DOMAIN ?? null;
    const actor = new ActorIdentity('system', 'email-inbound-worker', orgId, ['*'], ['admin']);

    await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`);
      const ctx: RequestContext = { db: tx, actor, correlationId: randomUUID() };
      await withContext(ctx, async () => {
        const resolution = await resolveInbound(tx, orgId, parsed, replyDomain);
        const contact = await this.emailService.findOrCreateContactByEmail(
          tx,
          orgId,
          parsed.fromAddress,
          parsed.fromName ?? undefined,
        );

        let conversationId: string;
        if (resolution) {
          conversationId = resolution.conversationId;
        } else {
          const next = await tx.execute<{ next: number } & Record<string, unknown>>(
            sql`SELECT conv_next_display_id(${orgId}) AS next`,
          );
          const displayId = next[0]!.next;
          const [newConv] = await tx
            .insert(schema.convConversations)
            .values({
              orgId,
              displayId,
              channelId: channel.id,
              contactId: contact.id,
              endUserId: contact.endUserId,
              status: 'open',
              subject: parsed.subject || null,
              lastMessageAt: new Date(),
            })
            .returning();
          conversationId = newConv!.id;
        }

        const [msg] = await tx
          .insert(schema.convMessages)
          .values({
            orgId,
            conversationId,
            authorType: 'end_user',
            authorId: contact.id,
            body: parsed.bodyText || '(no body)',
            bodyHtml: parsed.bodyHtml,
            internal: false,
            metadata: parsed.messageId ? { inboundMessageId: parsed.messageId } : {},
          })
          .returning();
        await tx
          .update(schema.convConversations)
          .set({ lastMessageAt: new Date(), updatedAt: new Date() })
          .where(eq(schema.convConversations.id, conversationId));

        await this.webhooks.emit({
          type: 'conversation.message.received',
          payload: {
            conversationId,
            messageId: msg!.id,
            authorType: 'end_user',
            internal: false,
          },
        });
      });
    });
  }

  private async readCursor(channelId: string): Promise<Record<string, unknown>> {
    const rows = await this.db
      .select({ cursor: schema.convInboundState.cursor })
      .from(schema.convInboundState)
      .where(eq(schema.convInboundState.channelId, channelId))
      .limit(1);
    return rows[0]?.cursor ?? {};
  }

  private async writeCursor(
    channelId: string,
    cursor: Record<string, unknown>,
    lastError: string | null,
  ): Promise<void> {
    await this.db
      .insert(schema.convInboundState)
      .values({ channelId, cursor, lastPolledAt: new Date(), lastError })
      .onConflictDoUpdate({
        target: schema.convInboundState.channelId,
        set: { cursor, lastPolledAt: new Date(), lastError, updatedAt: new Date() },
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
}

// ─── helpers ────────────────────────────────────────────────────────────────

export async function parseMessage(source: Buffer | string): Promise<ParsedInboundEmail> {
  const parsed: ParsedMail = await simpleParser(source);
  const recipients = collectAddresses(parsed.to)
    .concat(collectAddresses(parsed.cc))
    .concat(collectAddresses(parsed.bcc))
    .concat(
      parsed.headerLines
        .filter((h) => /^delivered-to$/i.test(h.key))
        .map((h) => h.line.split(':').slice(1).join(':').trim()),
    );

  const fromList = parsed.from?.value ?? [];
  const fromAddress = (fromList[0]?.address ?? '').toLowerCase();
  const fromName = fromList[0]?.name?.trim() || null;

  const html = typeof parsed.html === 'string' ? parsed.html : null;
  const text = (parsed.text ?? '').trim() || stripHtml(html ?? '');
  const refs = parsed.references;
  const referencesText = Array.isArray(refs) ? refs.join(' ') : refs;
  return {
    recipients,
    fromAddress,
    fromName,
    subject: (parsed.subject ?? '').trim(),
    messageId: parsed.messageId ? stripMessageIdBrackets(parsed.messageId) : null,
    inReplyTo: parsed.inReplyTo ? stripMessageIdBrackets(parsed.inReplyTo) : null,
    references: parseMessageIdHeader(referencesText),
    bodyText: text,
    bodyHtml: html,
  };
}

function collectAddresses(field: AddressObject | AddressObject[] | undefined): string[] {
  if (!field) return [];
  const objects = Array.isArray(field) ? field : [field];
  return objects
    .flatMap((obj) => obj.value)
    .map((a) => (a.name ? `${a.name} <${a.address ?? ''}>` : (a.address ?? '')))
    .filter(Boolean);
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function composeFrom(name: string | undefined, address: string): string {
  if (!name) return address;
  const clean = name.replace(/[",\r\n]/g, '').trim();
  return `${clean} <${address}>`;
}

function extractToFromMetadata(metadata: Record<string, unknown>): string | null {
  const v = (metadata as { recipient?: unknown }).recipient;
  return typeof v === 'string' ? v : null;
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
