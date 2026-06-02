import { Inject, Injectable, Logger } from '@nestjs/common';
import { schema, type Db } from '@getmunin/db';
import { and, eq, sql } from 'drizzle-orm';
import {
  ActorIdentity,
  WebhookDispatcher,
  resolvePublicHost,
  signEmailOpenToken,
  withContext,
  type Mailer,
  type RequestContext,
} from '@getmunin/core';
import { readPublicBaseUrl } from '../../../oauth/oauth.constants.ts';
import { ImapFlow } from 'imapflow';
import { simpleParser, type ParsedMail, type AddressObject } from 'mailparser';
import { randomUUID } from 'node:crypto';
import { createTransport, type Transporter } from 'nodemailer';
import { DB } from '../../../common/db/db.module.ts';
import { MAILER } from '../../../common/mail/mail.module.ts';
import { CuratorJobsService } from '../../curator/curator-jobs.service.ts';
import {
  EmailService,
  jsonbToStored,
  type StoredEmailChannelConfig,
} from './email.service.ts';
import { smtpTransportOptions } from './email.tools.ts';
import { buildOutbound, stripMessageIdBrackets, parseMessageIdHeader, type BuiltMessage } from './mime.ts';
import { renderEmailHtml } from './markdown.ts';
import { resolveInbound, type ParsedInboundEmail } from './threading.ts';
import {
  detectSignatureBlock,
  ensureReSubject,
  formatQuotedHistory,
  loadPriorMessagesForQuote,
  splitSignatureText,
  stripQuotedReplyHtml,
  stripQuotedReplyText,
  stripSignatureHtml,
} from './reply-history.ts';
import { classifySender, hasAnyClassification } from './classify-sender.ts';
import type {
  ChannelAdapter,
  ChannelRow,
  InboundMode,
  PollTickResult,
  SendContext,
  SendResult,
} from '../channels/adapter.ts';

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
  private static readonly logger = new Logger(ImapFlowFetcher.name);

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
    const resolved = await resolvePublicHost(opts.host);
    const client = new ImapFlow({
      host: resolved?.address ?? opts.host,
      port: opts.port,
      secure: opts.secure,
      auth: { user: opts.username, pass: opts.password },
      logger: false,
      ...(resolved && resolved.address !== opts.host
        ? { tls: { servername: opts.host } }
        : {}),
    });
    client.on('error', (err) => {
      ImapFlowFetcher.logger.warn(
        `imap late error host=${opts.host} user=${opts.username}: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
    try {
      await client.connect();
    } catch (err) {
      client.close();
      throw err;
    }
    try {
      await client.mailboxOpen(opts.mailbox);
      const range = opts.sinceUid ? `${opts.sinceUid + 1}:*` : '1:*';
      const out: ImapMessageMin[] = [];
      for await (const msg of client.fetch(range, { uid: true, source: true }, { uid: true })) {
        if (!msg.source) continue;
        out.push({ uid: msg.uid, source: msg.source });
        if (out.length >= opts.limit) break;
      }
      return out;
    } finally {
      await client.logout().catch((err) => {
        ImapFlowFetcher.logger.warn(
          `imap logout failed host=${opts.host}: ${err instanceof Error ? err.message : String(err)}`,
        );
        client.close();
      });
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
  readonly vendors = ['smtp', 'mailer'] as const;

  private readonly logger = new Logger(EmailAdapter.name);
  private fetcher: ImapFetcher = new ImapFlowFetcher();

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(WebhookDispatcher) private readonly webhooks: WebhookDispatcher,
    @Inject(MAILER) private readonly mailer: Mailer,
    @Inject(EmailService) private readonly emailService: EmailService,
    @Inject(CuratorJobsService) private readonly curatorJobs: CuratorJobsService,
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

    const channelFromName = config.addressing.fromName?.trim() || 'Support';
    const prior = await loadPriorMessagesForQuote(this.db, {
      conversationId: ctx.conversation.id,
      excludeMessageId: ctx.message.id,
      contactName: ctx.contact?.name?.trim() || null,
      contactEmail: ctx.contact?.email ?? null,
      channelFromName,
      limit: 3,
    });
    const quoted = formatQuotedHistory(prior, 3);
    const body = quoted ? `${ctx.message.body}\n\n${quoted}` : ctx.message.body;
    const html = ctx.message.bodyHtml ?? renderEmailHtml(ctx.message.body, prior, 3);

    const subject = ensureReSubject(ctx.conversation.subject?.trim() || null);
    const trackerUrl = trackerUrlFor(config, ctx, html);

    const built: BuiltMessage = buildOutbound({
      from: composeFrom(config.addressing.fromName, config.addressing.fromAddress),
      to: recipient,
      replyTo: this.composeReplyTo(config, ctx.conversation.id),
      subject,
      text: body,
      html,
      messageIdDomain: config.addressing.fromAddress,
      inReplyTo: ctx.delivery.inReplyToHeader ?? undefined,
      references: ctx.delivery.inReplyToHeader ? [ctx.delivery.inReplyToHeader] : undefined,
      trackerUrl,
    });

    if (config.outbound.provider === 'smtp') {
      const resolved = await resolvePublicHost(config.outbound.host);
      const password = await this.db.transaction(async (tx) => {
        return this.emailService.decryptSmtpPassword(
          tx,
          config.outbound.provider === 'smtp' ? config.outbound.encryptedPassword : '',
        );
      });
      const transport: Transporter = createTransport(
        smtpTransportOptions(
          config.outbound.host,
          config.outbound.port,
          config.outbound.secure,
          { user: config.outbound.username, pass: password },
          resolved?.address,
        ),
      );
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
      await this.writeCursor(channel.id, { lastUid: sinceUid ?? null });
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
        const errMsg = err instanceof Error ? err.message : String(err);
        lastError = errMsg;
        this.logger.warn(`parse failed uid=${msg.uid} channel=${channel.id}: ${errMsg}`);
      }
      if (msg.uid > highWater) highWater = msg.uid;
    }
    await this.writeCursor(channel.id, { lastUid: highWater });
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
        if (parsed.messageId) {
          const dup = await tx
            .select({ id: schema.convMessages.id })
            .from(schema.convMessages)
            .where(
              and(
                eq(schema.convMessages.orgId, orgId),
                sql`${schema.convMessages.metadata}->>'inboundMessageId' = ${parsed.messageId}`,
              ),
            )
            .limit(1);
          if (dup[0]) return;
        }
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
          if (contact.endUserId) {
            await tx
              .update(schema.convConversations)
              .set({ endUserId: contact.endUserId })
              .where(
                and(
                  eq(schema.convConversations.id, conversationId),
                  sql`${schema.convConversations.endUserId} IS NULL`,
                ),
              );
          }
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

        const quoteStrippedText = stripQuotedReplyText(parsed.bodyText);
        const { clean: cleanText, signature: regexSignature } = splitSignatureText(quoteStrippedText);
        const regexCutSignature = regexSignature !== null;
        const detectedSignatureForMeta =
          regexSignature ?? detectSignatureBlock(quoteStrippedText, parsed.bodyHtml);
        const cleanHtml = stripSignatureHtml(stripQuotedReplyHtml(parsed.bodyHtml));
        const [msg] = await tx
          .insert(schema.convMessages)
          .values({
            orgId,
            conversationId,
            authorType: 'end_user',
            authorId: contact.id,
            body: cleanText || '(no body)',
            bodyHtml: cleanHtml,
            internal: false,
            metadata: buildInboundMetadata(parsed, {
              regexSignatureText: detectedSignatureForMeta,
              preStripBody: regexCutSignature ? quoteStrippedText : null,
            }),
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

        if (!regexCutSignature && cleanText && cleanText.length >= 80) {
          await this.curatorJobs.enqueue({
            jobUri: 'skill://conv/strip-email-signature',
            userPrompt:
              `Run the signature-stripping skill on this inbound email message.\n\n` +
              `Message ID: ${msg!.id}\n` +
              `Sender: ${parsed.fromAddress}\n\n` +
              `Body:\n${cleanText}`,
            sourceEventType: 'conversation.message.received',
            sourceEventPayload: {
              conversationId,
              messageId: msg!.id,
              channelType: 'email',
            },
            dedupeKey: `strip-sig:msg:${msg!.id}`,
          });
        }
      });
    });
  }

  private async readCursor(channelId: string): Promise<Record<string, unknown>> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`);
      const rows = await tx
        .select({ cursor: schema.convInboundState.cursor })
        .from(schema.convInboundState)
        .where(eq(schema.convInboundState.channelId, channelId))
        .limit(1);
      return rows[0]?.cursor ?? {};
    });
  }

  private async writeCursor(
    channelId: string,
    cursor: Record<string, unknown>,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`);
      await tx
        .insert(schema.convInboundState)
        .values({ channelId, cursor, lastPolledAt: new Date() })
        .onConflictDoUpdate({
          target: schema.convInboundState.channelId,
          set: { cursor, lastPolledAt: new Date(), updatedAt: new Date() },
        });
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
  const senderClassification = classifySender(parsed.headerLines, fromAddress);
  const authenticationResults = extractHeaderValues(parsed.headerLines, 'authentication-results');
  const arcAuthenticationResults = extractHeaderValues(
    parsed.headerLines,
    'arc-authentication-results',
  );
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
    senderClassification,
    authenticationResults,
    arcAuthenticationResults,
  };
}

function extractHeaderValues(
  headerLines: ReadonlyArray<{ key: string; line: string }>,
  name: string,
): string[] {
  const lower = name.toLowerCase();
  const out: string[] = [];
  for (const h of headerLines) {
    if (h.key.toLowerCase() !== lower) continue;
    const value = h.line.split(':').slice(1).join(':').trim();
    if (value) out.push(value);
  }
  return out;
}

function buildInboundMetadata(
  parsed: ParsedInboundEmail,
  extras: { regexSignatureText: string | null; preStripBody: string | null },
): Record<string, unknown> {
  const meta: Record<string, unknown> = {};
  if (parsed.messageId) meta.inboundMessageId = parsed.messageId;
  if (extras.regexSignatureText) meta.signatureText = extras.regexSignatureText;
  if (extras.preStripBody) meta.preStripBody = extras.preStripBody;
  if (hasAnyClassification(parsed.senderClassification)) {
    meta.senderClassification = parsed.senderClassification;
  }
  if (parsed.authenticationResults.length > 0) {
    meta.authenticationResults = parsed.authenticationResults;
  }
  if (parsed.arcAuthenticationResults.length > 0) {
    meta.arcAuthenticationResults = parsed.arcAuthenticationResults;
  }
  return meta;
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

function trackerUrlFor(
  config: StoredEmailChannelConfig,
  ctx: SendContext,
  html: string | undefined,
): string | undefined {
  if (!config.outbound.trackOpens) return undefined;
  if (!html) return undefined;
  if (!process.env.MUNIN_KEY_PEPPER) return undefined;
  try {
    const token = signEmailOpenToken({
      orgId: ctx.channel.orgId,
      deliveryId: ctx.delivery.id,
    });
    return `${readPublicBaseUrl()}/v1/c/o/${token}.gif`;
  } catch {
    return undefined;
  }
}
