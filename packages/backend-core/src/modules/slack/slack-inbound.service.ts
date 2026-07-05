import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { schema, type Db } from '@getmunin/db';
import { ActorIdentity, describeError, withContext, type RequestContext } from '@getmunin/core';
import { DB } from '../../common/db/db.module.ts';
import { ConvService } from '../conv/conv.service.ts';
import { SlackApiClient } from './slack-api.client.ts';
import { SlackUserMappingService } from './slack-user-mapping.service.ts';
import { decryptSecretValue } from './slack.service.ts';

const INTERNAL_NOTE_PREFIX = '!';

const MessageEventSchema = z.object({
  type: z.literal('message'),
  subtype: z.string().optional(),
  channel: z.string().min(1),
  user: z.string().optional(),
  bot_id: z.string().optional(),
  text: z.string().optional(),
  ts: z.string().min(1),
  thread_ts: z.string().optional(),
});

const EventCallbackSchema = z.object({
  type: z.literal('event_callback'),
  event: z.unknown(),
});

type MessageEvent = z.infer<typeof MessageEventSchema>;

/**
 * Slack → Munin direction of the bridge. A reply in a mirrored thread is
 * recorded through ConvService.sendMessage() as the mapped org member, so
 * outbound-to-customer delivery, claim, and attention semantics are exactly
 * the dashboard's. Replies from Slack users with no Munin mapping are
 * rejected with an ephemeral notice — never silently attributed.
 */
@Injectable()
export class SlackInboundService {
  private readonly logger = new Logger(SlackInboundService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(SlackApiClient) private readonly api: SlackApiClient,
    @Inject(ConvService) private readonly conv: ConvService,
    @Inject(SlackUserMappingService) private readonly mapping: SlackUserMappingService,
  ) {}

  async processEventCallback(payload: Record<string, unknown>): Promise<void> {
    const callback = EventCallbackSchema.safeParse(payload);
    if (!callback.success) return;
    const parsed = MessageEventSchema.safeParse(callback.data.event);
    if (!parsed.success) return;
    const event = parsed.data;

    if (event.subtype !== undefined && event.subtype !== 'thread_broadcast') return;
    if (!event.thread_ts || event.thread_ts === event.ts) return;
    if (event.bot_id || !event.user) return;
    const text = (event.text ?? '').trim();
    if (text.length === 0) return;

    const [link] = await this.db
      .select()
      .from(schema.slackConversationLinks)
      .where(
        and(
          eq(schema.slackConversationLinks.slackChannelId, event.channel),
          eq(schema.slackConversationLinks.slackThreadTs, event.thread_ts),
        ),
      )
      .limit(1);
    if (!link) return;

    const [alreadyLinked] = await this.db
      .select({ id: schema.slackMessageLinks.id })
      .from(schema.slackMessageLinks)
      .where(
        and(
          eq(schema.slackMessageLinks.slackChannelId, event.channel),
          eq(schema.slackMessageLinks.slackTs, event.ts),
        ),
      )
      .limit(1);
    if (alreadyLinked) return;

    const [integration] = await this.db
      .select()
      .from(schema.slackIntegrations)
      .where(eq(schema.slackIntegrations.id, link.integrationId))
      .limit(1);
    if (!integration || !integration.active) return;
    if (integration.botUserId && event.user === integration.botUserId) return;

    const token = await decryptSecretValue(this.db, integration.encryptedBotToken);
    const userId = await this.mapping.resolveMuninUser(integration, event.user, token);
    if (!userId) {
      await this.rejectReply(token, event);
      return;
    }

    const internal = text.startsWith(INTERNAL_NOTE_PREFIX);
    const body = internal ? text.slice(INTERNAL_NOTE_PREFIX.length).trim() : text;
    if (body.length === 0) return;

    const actor = new ActorIdentity(
      'user',
      userId,
      integration.orgId,
      ['*'],
      ['admin'],
      undefined,
      undefined,
      undefined,
      userId,
    );
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`);
      const ctx: RequestContext = { db: tx, actor, correlationId: randomUUID() };
      await withContext(ctx, async () => {
        const message = await this.conv.sendMessage({
          conversationId: link.conversationId,
          body,
          internal,
          authorType: 'user',
          authorId: userId,
        });
        await tx.insert(schema.slackMessageLinks).values({
          orgId: integration.orgId,
          conversationId: link.conversationId,
          messageId: message.id,
          slackChannelId: event.channel,
          slackTs: event.ts,
          origin: 'slack',
        });
      });
    });
  }

  private async rejectReply(token: string, event: MessageEvent): Promise<void> {
    try {
      await this.api.postEphemeral({
        token,
        channel: event.channel,
        user: event.user!,
        threadTs: event.thread_ts,
        text: ':no_entry: Your reply was *not sent to the customer* — your Slack account is not linked to a member of this Munin org. Ask an admin to add you with your Slack email, or reply from the Munin dashboard.',
      });
    } catch (err) {
      this.logger.warn(`ephemeral rejection notice failed: ${describeError(err)}`);
    }
  }
}
