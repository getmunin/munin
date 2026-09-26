import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { schema, type Db, type Tx } from '@getmunin/db';
import {
  ActorIdentity,
  WebhookDispatcher,
  withContext,
  type RequestContext,
} from '@getmunin/core';
import { DB } from '../../../common/db/db.module.ts';
import { ConvAttachmentsService } from '../attachments/conv-attachments.service.ts';
import { parseMessageAttachmentProjection } from '../attachments/conv-attachments.projection.ts';
import type {
  ChannelAdapter,
  ChannelRow,
  InboundBatch,
  InboundMode,
  IncomingWebhookRequest,
  SendContext,
  SendResult,
  WebhookResponse,
} from '../channels/adapter.ts';
import {
  MetaGraphClientService,
  deriveVerifyToken,
  verifyMetaSignature,
  type MetaAuth,
} from './meta-graph-client.service.ts';
import {
  parseMetaWebhook,
  type MetaReaction,
  type MetaStatusUpdate,
} from './meta-webhook-payload.ts';
import { jsonbToStored } from './meta-whatsapp.service.ts';
import { readWhatsAppTemplateSend, toTemplateSendParameters } from './whatsapp-templates.ts';
import { WHATSAPP_WINDOW_CLOSED_ERROR_CODES, whatsappWindowClosedError } from './whatsapp-window.ts';

type SignableAttachments = Pick<ConvAttachmentsService, 'signUrl'>;

@Injectable()
export class MetaWhatsAppAdapter implements ChannelAdapter {
  readonly kind = 'whatsapp' as const;
  readonly vendors = ['meta'] as const;

  private readonly logger = new Logger(MetaWhatsAppAdapter.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(MetaGraphClientService) private readonly client: MetaGraphClientService,
    @Inject(WebhookDispatcher) private readonly webhooks: WebhookDispatcher,
    @Inject(ConvAttachmentsService) private readonly attachments: SignableAttachments,
  ) {}

  readonly inbound: InboundMode = {
    mode: 'webhook',
    verify: (req, channel) => this.verify(req, channel),
    toResponse: (): WebhookResponse => ({
      status: 200,
      contentType: 'text/plain; charset=utf-8',
      body: 'OK',
    }),
    challenge: (req, channelId) => answerChallenge(req, channelId),
  };

  async send(ctx: SendContext): Promise<SendResult> {
    const stored = jsonbToStored(ctx.channel.config);
    const to = ctx.contact?.phone;
    if (!to) throw new Error('whatsapp_send_missing_recipient_phone');
    const auth: MetaAuth = {
      accessToken: await this.client.loadSecret(stored.encryptedAccessToken),
      graphApiVersion: stored.graphApiVersion,
    };

    const template = readWhatsAppTemplateSend(ctx.message.metadata);
    if (template) {
      const res = await this.client.sendTemplate(auth, stored.phoneNumberId, to, {
        name: template.name,
        language: template.language,
        parameters: toTemplateSendParameters(template),
      });
      return { providerMessageId: res.wamid, rawResponse: res };
    }

    const images = parseMessageAttachmentProjection(ctx.message.attachments).filter(
      (a) => !a.deleted && a.mime.startsWith('image/'),
    );
    let firstWamid: string | null = null;
    const body = ctx.message.body.trim();
    if (body.length > 0) {
      const res = await this.client.sendText(auth, stored.phoneNumberId, to, ctx.message.body);
      firstWamid = res.wamid;
    }
    for (const image of images) {
      const link = this.attachments.signUrl(ctx.channel.orgId, image.id);
      if (!link) throw new Error('whatsapp_send_attachment_unsigned: MUNIN_KEY_PEPPER is not set');
      const res = await this.client.sendImage(auth, stored.phoneNumberId, to, link);
      firstWamid ??= res.wamid;
    }
    if (!firstWamid) throw new Error('whatsapp_send_empty_message');
    return { providerMessageId: firstWamid };
  }

  private async verify(req: IncomingWebhookRequest, channel: ChannelRow): Promise<InboundBatch> {
    const stored = jsonbToStored(channel.config);
    const appSecret = await this.client.loadSecret(stored.encryptedAppSecret);
    const signature = headerOne(req.headers, 'x-hub-signature-256') ?? '';
    if (!signature) throw new Error('whatsapp_signature_missing');
    if (!verifyMetaSignature({ appSecret, rawBody: req.rawBody, signatureHeader: signature })) {
      throw new Error('whatsapp_signature_invalid');
    }

    let body: unknown;
    try {
      body = JSON.parse(req.rawBody.toString('utf8'));
    } catch {
      throw new Error('whatsapp_payload_not_json');
    }
    const parsed = parseMetaWebhook(body, stored.phoneNumberId);

    for (const status of parsed.statuses) await this.applyStatus(channel, status);
    for (const reaction of parsed.reactions) await this.applyReaction(channel, reaction);

    if (parsed.messages.length === 0) return { messages: [] };

    const auth = async (): Promise<MetaAuth> => ({
      accessToken: await this.client.loadSecret(stored.encryptedAccessToken),
      graphApiVersion: stored.graphApiVersion,
    });

    return {
      messages: parsed.messages.map((m) => ({
        fromIdentity: { phone: m.from, ...(m.name ? { name: m.name } : {}) },
        body: m.body,
        providerMessageId: m.wamid,
        inReplyTo: m.contextWamid,
        receivedAt: m.receivedAt,
        raw: m.raw,
        metadata: { whatsappType: m.kind, ...m.metadata },
        ...(m.media
          ? {
              media: [
                {
                  name: m.media.name,
                  fetch: async () => this.client.downloadMedia(await auth(), m.media!.id),
                },
              ],
            }
          : {}),
      })),
    };
  }

  private async applyStatus(channel: ChannelRow, status: MetaStatusUpdate): Promise<void> {
    if (status.status === 'unknown') return;
    await this.withSystemTx(channel.orgId, async (tx) => {
      const rows = await tx
        .select({
          id: schema.convMessageDeliveries.id,
          messageId: schema.convMessageDeliveries.messageId,
          status: schema.convMessageDeliveries.status,
          firstOpenedAt: schema.convMessageDeliveries.firstOpenedAt,
          conversationId: schema.convMessages.conversationId,
        })
        .from(schema.convMessageDeliveries)
        .innerJoin(schema.convMessages, eq(schema.convMessages.id, schema.convMessageDeliveries.messageId))
        .where(
          and(
            eq(schema.convMessageDeliveries.orgId, channel.orgId),
            eq(schema.convMessageDeliveries.channelId, channel.id),
            eq(schema.convMessageDeliveries.messageIdHeader, status.wamid),
          ),
        )
        .limit(1);
      const delivery = rows[0];
      if (!delivery) return;

      if (status.status === 'read') {
        if (delivery.firstOpenedAt) return;
        await tx
          .update(schema.convMessageDeliveries)
          .set({
            firstOpenedAt: status.at,
            lastOpenedAt: status.at,
            openCount: 1,
            updatedAt: new Date(),
          })
          .where(eq(schema.convMessageDeliveries.id, delivery.id));
        await this.webhooks.emit({
          type: 'conversation.message.opened',
          payload: {
            deliveryId: delivery.id,
            messageId: delivery.messageId,
            firstOpenedAt: status.at.toISOString(),
          },
        });
        return;
      }

      if (status.status === 'failed') {
        if (delivery.status === 'dead') return;
        const error = describeStatusError(status);
        await tx
          .update(schema.convMessageDeliveries)
          .set({ status: 'dead', error, nextAttemptAt: null, updatedAt: new Date() })
          .where(eq(schema.convMessageDeliveries.id, delivery.id));
        await this.webhooks.emit({
          type: 'conversation.message.delivery_failed',
          payload: {
            conversationId: delivery.conversationId,
            messageId: delivery.messageId,
            channelId: channel.id,
            error,
          },
        });
        return;
      }

      if (delivery.status === 'dead') return;
      await tx
        .update(schema.convMessageDeliveries)
        .set({ status: 'sent', updatedAt: new Date() })
        .where(eq(schema.convMessageDeliveries.id, delivery.id));
    });
  }

  private async applyReaction(channel: ChannelRow, reaction: MetaReaction): Promise<void> {
    await this.withSystemTx(channel.orgId, async (tx) => {
      const viaDelivery = await tx
        .select({ messageId: schema.convMessageDeliveries.messageId })
        .from(schema.convMessageDeliveries)
        .where(
          and(
            eq(schema.convMessageDeliveries.orgId, channel.orgId),
            eq(schema.convMessageDeliveries.channelId, channel.id),
            eq(schema.convMessageDeliveries.messageIdHeader, reaction.targetWamid),
          ),
        )
        .limit(1);
      let messageId = viaDelivery[0]?.messageId ?? null;
      if (!messageId) {
        const viaInbound = await tx
          .select({ id: schema.convMessages.id })
          .from(schema.convMessages)
          .where(
            and(
              eq(schema.convMessages.orgId, channel.orgId),
              sql`${schema.convMessages.metadata}->>'providerMessageId' = ${reaction.targetWamid}`,
            ),
          )
          .limit(1);
        messageId = viaInbound[0]?.id ?? null;
      }
      if (!messageId) return;
      const value = reaction.emoji
        ? sql`${schema.convMessages.metadata} || jsonb_build_object('whatsappReaction', jsonb_build_object('emoji', ${reaction.emoji}::text, 'from', ${reaction.from}::text, 'at', ${reaction.at.toISOString()}::text))`
        : sql`${schema.convMessages.metadata} - 'whatsappReaction'`;
      await tx
        .update(schema.convMessages)
        .set({ metadata: value })
        .where(eq(schema.convMessages.id, messageId));
    });
  }

  private async withSystemTx(orgId: string, fn: (tx: Tx) => Promise<void>): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`);
      const actor = new ActorIdentity('system', 'channel-webhook-whatsapp', orgId, ['*'], ['admin']);
      const ctx: RequestContext = { db: tx, actor, correlationId: randomUUID() };
      await withContext(ctx, () => fn(tx));
    });
  }
}

export function answerChallenge(req: IncomingWebhookRequest, channelId: string): WebhookResponse | null {
  const mode = queryOne(req.query, 'hub.mode');
  const token = queryOne(req.query, 'hub.verify_token');
  const challenge = queryOne(req.query, 'hub.challenge');
  if (mode !== 'subscribe' || !token || !challenge) return null;
  let expected: string;
  try {
    expected = deriveVerifyToken(channelId);
  } catch {
    return null;
  }
  if (token !== expected) return null;
  return { status: 200, contentType: 'text/plain; charset=utf-8', body: challenge };
}

function describeStatusError(status: MetaStatusUpdate): string {
  const first = status.errors[0];
  if (first?.code !== null && first?.code !== undefined && WHATSAPP_WINDOW_CLOSED_ERROR_CODES.has(first.code)) {
    return whatsappWindowClosedError(first.message ?? first.title);
  }
  if (!first) return 'whatsapp_meta_failed';
  const detail = first.message ?? first.title;
  return `whatsapp_meta_${first.code ?? 'failed'}${detail ? `: ${detail}` : ''}`;
}

function headerOne(
  headers: Record<string, string | string[] | undefined>,
  key: string,
): string | undefined {
  const v = headers[key.toLowerCase()];
  if (Array.isArray(v)) return v[0];
  return v;
}

function queryOne(
  query: Record<string, string | string[] | undefined>,
  key: string,
): string | undefined {
  const v = query[key];
  if (Array.isArray(v)) return v[0];
  return v;
}
