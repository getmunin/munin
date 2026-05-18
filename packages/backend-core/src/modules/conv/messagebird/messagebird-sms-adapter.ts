import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql, eq } from 'drizzle-orm';
import { schema, type Db } from '@getmunin/db';
import { DB } from '../../../common/db/db.module.js';
import type {
  ChannelAdapter,
  ChannelRow,
  InboundBatch,
  InboundMode,
  IncomingWebhookRequest,
  SendContext,
  SendResult,
} from '../channels/adapter.js';
import {
  MessageBirdClientService,
  parseUrlEncoded,
  reconstructWebhookUrl,
  verifyMessageBirdJwt,
} from './messagebird-client.service.js';
import { jsonbToStored } from './messagebird-sms.service.js';

@Injectable()
export class MessageBirdSmsAdapter implements ChannelAdapter {
  readonly kind = 'sms' as const;
  readonly vendors = ['messagebird'] as const;

  private readonly logger = new Logger(MessageBirdSmsAdapter.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(MessageBirdClientService) private readonly client: MessageBirdClientService,
  ) {}

  readonly inbound: InboundMode = {
    mode: 'webhook',
    verify: (req, channel) => this.verify(req, channel),
    toResponse: () => ({ status: 200, contentType: 'text/plain; charset=utf-8', body: 'OK' }),
  };

  async send(ctx: SendContext): Promise<SendResult> {
    const config = jsonbToStored(ctx.channel.config);
    const to = ctx.contact?.phone;
    if (!to) throw new Error('messagebird_send_missing_recipient_phone');
    const accessKey = await this.client.loadSecret(config.encryptedAccessKey);
    const reportUrl = buildWebhookUrl(ctx.channel.id);
    const res = await this.client.sendSms({
      accessKey,
      originator: config.originator,
      recipient: stripPlus(to),
      body: ctx.message.body,
      reportUrl,
    });
    return { providerMessageId: res.id || null, rawResponse: res };
  }

  private async verify(req: IncomingWebhookRequest, channel: ChannelRow): Promise<InboundBatch> {
    const config = jsonbToStored(channel.config);
    const signingKey = await this.client.loadSecret(config.encryptedSigningKey);
    const token = headerOne(req.headers, 'messagebird-signature-jwt') ?? '';
    if (!token) throw new Error('messagebird_signature_missing');
    const url = reconstructWebhookUrl({
      headers: req.headers,
      pathWithQuery: `/api/v1/conversations/channels/${channel.id}/webhook`,
      fallbackBase: process.env.MUNIN_PUBLIC_URL,
    });
    const verified = verifyMessageBirdJwt({
      signingKey,
      token,
      url,
      rawBody: req.rawBody,
    });
    if (!verified.ok) throw new Error(`messagebird_${verified.error}`);

    const params = parseUrlEncoded(req.rawBody);

    if (params.status && params.id && !params.body) {
      await this.applyStatusReport(channel, params);
      return { messages: [] };
    }

    if (!params.id || !params.originator || params.body === undefined) {
      return { messages: [] };
    }

    const receivedAt = params.createdDatetime ? new Date(params.createdDatetime) : new Date();

    return {
      messages: [
        {
          fromIdentity: { phone: ensurePlus(params.originator) },
          body: params.body,
          providerMessageId: params.id,
          receivedAt: Number.isNaN(receivedAt.getTime()) ? new Date() : receivedAt,
          raw: { ...params },
        },
      ],
    };
  }

  private async applyStatusReport(channel: ChannelRow, params: Record<string, string>): Promise<void> {
    const id = params.id;
    if (!id) return;
    const mapped = mapMessageBirdStatus(params.status);
    if (!mapped) return;
    const error = params.statusReason
      ? `messagebird_${params.status}: ${params.statusReason}`
      : params.status === 'delivery_failed' || params.status === 'expired'
        ? `messagebird_${params.status}`
        : null;
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`);
      const update: Record<string, unknown> = {
        status: mapped,
        updatedAt: new Date(),
      };
      if (mapped === 'sent') update.sentAt = new Date();
      if (error) update.error = error;
      await tx
        .update(schema.convMessageDeliveries)
        .set(update)
        .where(eq(schema.convMessageDeliveries.messageIdHeader, id));
    });
    this.logger.log(`messagebird status report id=${id} status=${params.status} → ${mapped}`);
  }
}

function headerOne(
  headers: Record<string, string | string[] | undefined>,
  key: string,
): string | undefined {
  const v = headers[key.toLowerCase()];
  if (Array.isArray(v)) return v[0];
  return v;
}

function mapMessageBirdStatus(status: string | undefined): 'queued' | 'sent' | 'failed' | null {
  switch (status) {
    case 'sent':
    case 'delivered':
      return 'sent';
    case 'delivery_failed':
    case 'expired':
      return 'failed';
    case 'scheduled':
    case 'buffered':
      return 'queued';
    default:
      return null;
  }
}

function stripPlus(e164: string): string {
  return e164.startsWith('+') ? e164.slice(1) : e164;
}

function ensurePlus(msisdn: string): string {
  return msisdn.startsWith('+') ? msisdn : `+${msisdn}`;
}

function buildWebhookUrl(channelId: string): string | undefined {
  const base = process.env.MUNIN_PUBLIC_URL?.replace(/\/$/, '');
  if (!base) return undefined;
  return `${base}/api/v1/conversations/channels/${channelId}/webhook`;
}
