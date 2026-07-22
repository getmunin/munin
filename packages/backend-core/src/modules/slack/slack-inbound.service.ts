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
import { routePromptBlocks, routePromptText } from './slack-projection.ts';

const INTERNAL_NOTE_PREFIX = '!';
const ASSIGN_COMMAND_RE = /^!assign\s+(?:<@([A-Z0-9]+)(?:\|[^>]*)?>|me)\s*$/i;
const ALLOWED_SUBTYPES = new Set(['thread_broadcast', 'file_share']);

const MessageEventSchema = z.object({
  type: z.literal('message'),
  subtype: z.string().optional(),
  channel: z.string().min(1),
  user: z.string().optional(),
  bot_id: z.string().optional(),
  text: z.string().optional(),
  ts: z.string().min(1),
  thread_ts: z.string().optional(),
  files: z.array(z.object({}).passthrough()).optional(),
});

const MemberJoinedEventSchema = z.object({
  type: z.literal('member_joined_channel'),
  user: z.string().min(1),
  channel: z.string().min(1),
  team: z.string().optional(),
});

const EventCallbackSchema = z.object({
  type: z.literal('event_callback'),
  event: z.unknown(),
});

type MessageEvent = z.infer<typeof MessageEventSchema>;
type MemberJoinedEvent = z.infer<typeof MemberJoinedEventSchema>;

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
    const joined = MemberJoinedEventSchema.safeParse(callback.data.event);
    if (joined.success) {
      await this.handleBotJoinedChannel(joined.data);
      return;
    }
    const parsed = MessageEventSchema.safeParse(callback.data.event);
    if (!parsed.success) return;
    const event = parsed.data;

    if (event.subtype !== undefined && !ALLOWED_SUBTYPES.has(event.subtype)) return;
    if (!event.thread_ts || event.thread_ts === event.ts) return;
    if (event.bot_id || !event.user) return;
    const text = (event.text ?? '').trim();
    const fileCount = event.files?.length ?? 0;
    if (text.length === 0 && fileCount === 0) return;

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

    // Slack files live on Slack's authenticated CDN; forwarding them to the
    // customer would require download + re-hosting, which the bridge does not
    // do yet. Loudly refuse rather than silently dropping them.
    if (text.length === 0) {
      await this.notify(
        token,
        event,
        ':no_entry: Attachments are not forwarded to customers yet — your file was *not sent*. Add the content as text, or send it from the dashboard.',
      );
      return;
    }

    const assignMatch = ASSIGN_COMMAND_RE.exec(text);
    if (assignMatch) {
      await this.handleAssignCommand({
        integration,
        conversationId: link.conversationId,
        event,
        actorUserId: userId,
        mentionedSlackUserId: assignMatch[1] ?? null,
        token,
      });
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
          claim: false,
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

    if (fileCount > 0) {
      await this.notify(
        token,
        event,
        `:warning: Your message was sent *without* the ${fileCount} attached file${fileCount === 1 ? '' : 's'} — attachments are not forwarded to customers yet.`,
      );
    }
  }

  private async handleBotJoinedChannel(event: MemberJoinedEvent): Promise<void> {
    const integrations = await this.db
      .select()
      .from(schema.slackIntegrations)
      .where(
        and(
          eq(schema.slackIntegrations.botUserId, event.user),
          eq(schema.slackIntegrations.active, true),
          ...(event.team ? [eq(schema.slackIntegrations.teamId, event.team)] : []),
        ),
      );
    if (integrations.length !== 1) return;
    const integration = integrations[0]!;

    const [existingRoute] = await this.db
      .select({ id: schema.slackChannelRoutes.id })
      .from(schema.slackChannelRoutes)
      .where(
        and(
          eq(schema.slackChannelRoutes.teamId, integration.teamId),
          eq(schema.slackChannelRoutes.slackChannelId, event.channel),
        ),
      )
      .limit(1);
    if (existingRoute) return;

    const [org] = await this.db
      .select({ name: schema.orgs.name })
      .from(schema.orgs)
      .where(eq(schema.orgs.id, integration.orgId))
      .limit(1);

    const token = await decryptSecretValue(this.db, integration.encryptedBotToken);
    try {
      await this.api.postMessage({
        token,
        channel: event.channel,
        text: routePromptText(org?.name ?? null),
        blocks: routePromptBlocks(integration.id, org?.name ?? null),
      });
    } catch (err) {
      this.logger.warn(`route prompt failed for ${event.channel}: ${describeError(err)}`);
    }
  }

  private async handleAssignCommand(input: {
    integration: typeof schema.slackIntegrations.$inferSelect;
    conversationId: string;
    event: MessageEvent;
    actorUserId: string;
    mentionedSlackUserId: string | null;
    token: string;
  }): Promise<void> {
    const { integration, conversationId, event, actorUserId, mentionedSlackUserId, token } = input;
    let assigneeUserId = actorUserId;
    if (mentionedSlackUserId) {
      const mapped = await this.mapping.resolveMuninUser(integration, mentionedSlackUserId, token);
      if (!mapped) {
        await this.notify(
          token,
          event,
          ':no_entry: That person is not linked to a Munin member — link them with slack_link_user, or have them reply in a thread once so the email match runs.',
        );
        return;
      }
      assigneeUserId = mapped;
    }

    const actor = new ActorIdentity(
      'user',
      actorUserId,
      integration.orgId,
      ['*'],
      ['admin'],
      undefined,
      undefined,
      undefined,
      actorUserId,
    );
    try {
      await this.db.transaction(async (tx) => {
        await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`);
        const ctx: RequestContext = { db: tx, actor, correlationId: randomUUID() };
        await withContext(ctx, () =>
          this.conv.assignConversation({ id: conversationId, assigneeUserId }),
        );
      });
    } catch (err) {
      this.logger.warn(`!assign failed for ${conversationId}: ${describeError(err)}`);
      await this.notify(token, event, ':no_entry: Could not assign — try from the dashboard.');
    }
  }

  private async rejectReply(token: string, event: MessageEvent): Promise<void> {
    await this.notify(
      token,
      event,
      ':no_entry: Your reply was *not sent to the customer* — your Slack account is not linked to a member of this Munin org. Ask an admin to add you with your Slack email, or reply from the Munin dashboard.',
    );
  }

  private async notify(token: string, event: MessageEvent, text: string): Promise<void> {
    try {
      await this.api.postEphemeral({
        token,
        channel: event.channel,
        user: event.user!,
        threadTs: event.thread_ts,
        text,
      });
    } catch (err) {
      this.logger.warn(`ephemeral notice failed: ${describeError(err)}`);
    }
  }
}
