import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { schema, type Db } from '@munin/db';
// `Db` is the constructor-injected type (DB token); workers receive the
// pool, transactions get the narrower `Tx` type from drizzle automatically.
import { and, eq, sql } from 'drizzle-orm';
import {
  ActorIdentity,
  WebhookDispatcher,
  withContext,
  type RequestContext,
} from '@munin/core';
import { ImapFlow } from 'imapflow';
import { simpleParser, type ParsedMail, type AddressObject } from 'mailparser';
import { randomUUID } from 'node:crypto';
import { DB } from '../../../common/db/db.module.js';
import {
  EmailService,
  jsonbToStored,
  type StoredEmailChannelConfig,
} from './email.service.js';
import { stripMessageIdBrackets, parseMessageIdHeader } from './mime.js';
import { resolveInbound, type ParsedInboundEmail } from './threading.js';

const POLL_INTERVAL_MS = Number(process.env.MUNIN_EMAIL_INBOUND_POLL_MS ?? 60_000);
const MAX_MESSAGES_PER_TICK = 100;

interface ImapMessageMin {
  uid: number;
  /** Full RFC-822 source. */
  source: Buffer | string;
}

/**
 * IMAP fetcher boundary. The real implementation is `ImapFlowFetcher` (lazy
 * import so tests that mock the boundary don't pull in `imapflow`). Tests
 * provide a stub fetcher that returns whatever messages they want to push.
 */
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
 * Polls every active email channel's IMAP mailbox and threads new messages
 * into existing conversations (or creates new ones). Mirrors the
 * `WebhookWorker` shape: one Nest provider, OnModuleInit/Destroy lifecycle,
 * `MUNIN_EMAIL_INBOUND_WORKER_DISABLED=1` test lever, public `tick()`.
 *
 * Tests inject a stub `ImapFetcher` via `setFetcher()` to avoid running a
 * real IMAP server in the test harness.
 */
@Injectable()
export class EmailInboundWorker implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private disabled =
    process.env.MUNIN_EMAIL_INBOUND_WORKER_DISABLED === '1' ||
    process.env.NODE_ENV === 'test';
  private fetcher: ImapFetcher = new ImapFlowFetcher();

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(WebhookDispatcher) private readonly webhooks: WebhookDispatcher,
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

  /** Test-only: swap the IMAP boundary for a stub. */
  setFetcher(f: ImapFetcher): void {
    this.fetcher = f;
  }

  async tick(): Promise<{ channelsPolled: number; messagesIngested: number }> {
    if (this.running) return { channelsPolled: 0, messagesIngested: 0 };
    this.running = true;
    try {
      return await this.pollAll();
    } finally {
      this.running = false;
    }
  }

  private async pollAll(): Promise<{ channelsPolled: number; messagesIngested: number }> {
    const channels = await this.db
      .select()
      .from(schema.convChannels)
      .where(and(eq(schema.convChannels.type, 'email'), eq(schema.convChannels.active, true)));

    let polled = 0;
    let ingested = 0;
    for (const channel of channels) {
      const config = jsonbToStored(channel.config);
      if (!config.inbound) continue;
      try {
        const n = await this.pollOne(channel, config);
        ingested += n;
        polled += 1;
      } catch (err) {
        await this.recordChannelError(channel.id, err);
      }
    }
    return { channelsPolled: polled, messagesIngested: ingested };
  }

  private async pollOne(
    channel: typeof schema.convChannels.$inferSelect,
    config: StoredEmailChannelConfig,
  ): Promise<number> {
    const stateRows = await this.db
      .select()
      .from(schema.convEmailInboundState)
      .where(eq(schema.convEmailInboundState.channelId, channel.id))
      .limit(1);
    const state = stateRows[0] ?? null;
    const sinceUid = state?.lastUidSeen ?? null;

    const password = await this.db.transaction((tx) =>
      this.emailService.decryptImapPassword(tx, config.inbound!.encryptedPassword),
    );

    const messages = await this.fetcher.fetchSince({
      host: config.inbound!.host,
      port: config.inbound!.port,
      secure: config.inbound!.secure,
      username: config.inbound!.username,
      password,
      mailbox: config.inbound!.mailbox ?? 'INBOX',
      sinceUid,
      limit: MAX_MESSAGES_PER_TICK,
    });

    if (messages.length === 0) {
      await this.upsertState(channel.id, sinceUid, null);
      return 0;
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
    await this.upsertState(channel.id, highWater, lastError);
    return ingested;
  }

  private async ingest(
    channel: typeof schema.convChannels.$inferSelect,
    parsed: ParsedInboundEmail,
  ): Promise<void> {
    if (!parsed.fromAddress) return;
    const orgId = channel.orgId;
    const replyDomain = process.env.MUNIN_EMAIL_REPLY_DOMAIN ?? null;

    const actor = new ActorIdentity('system', 'email-inbound-worker', orgId, ['*'], ['admin']);

    await this.db.transaction(async (tx) => {
      // Bypass RLS — service-role worker has no JWT-bound org_id GUC.
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`);
      const ctx: RequestContext = {
        db: tx,
        actor,
        correlationId: randomUUID(),
      };
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

  private async upsertState(
    channelId: string,
    lastUid: number | null,
    lastError: string | null,
  ): Promise<void> {
    await this.db
      .insert(schema.convEmailInboundState)
      .values({
        channelId,
        lastUidSeen: lastUid ?? null,
        lastPolledAt: new Date(),
        lastError,
      })
      .onConflictDoUpdate({
        target: schema.convEmailInboundState.channelId,
        set: {
          lastUidSeen: lastUid ?? null,
          lastPolledAt: new Date(),
          lastError,
          updatedAt: new Date(),
        },
      });
  }

  private async recordChannelError(channelId: string, err: unknown): Promise<void> {
    const message = err instanceof Error ? err.message : String(err);
    await this.upsertState(channelId, null, message);
  }
}

// ─── parsing ───────────────────────────────────────────────────────────────

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
