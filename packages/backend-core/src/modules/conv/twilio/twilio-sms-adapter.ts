import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql, eq } from 'drizzle-orm';
import { schema, type Db } from '@getmunin/db';
import { DB } from '../../../common/db/db.module.ts';
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
  TwilioClientService,
  parseUrlEncoded,
  reconstructWebhookUrl,
  validateTwilioSignature,
} from './twilio-client.service.ts';
import { jsonbToStored } from './twilio-sms.service.ts';

const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

@Injectable()
export class TwilioSmsAdapter implements ChannelAdapter {
  readonly kind = 'sms' as const;
  readonly vendors = ['twilio'] as const;

  private readonly logger = new Logger(TwilioSmsAdapter.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(TwilioClientService) private readonly client: TwilioClientService,
  ) {}

  readonly inbound: InboundMode = {
    mode: 'webhook',
    verify: (req, channel) => this.verify(req, channel),
    toResponse: (): WebhookResponse => ({
      status: 200,
      contentType: 'text/xml; charset=utf-8',
      body: EMPTY_TWIML,
    }),
  };

  async send(ctx: SendContext): Promise<SendResult> {
    const config = jsonbToStored(ctx.channel.config);
    const to = ctx.contact?.phone;
    if (!to) throw new Error('twilio_sms_send_missing_recipient_phone');
    const authToken = await this.client.loadAuthToken(config.encryptedAuthToken);
    const statusCallback = buildWebhookUrl(ctx.channel.id);
    const res = await this.client.sendSms({
      accountSid: config.accountSid,
      authToken,
      to,
      body: ctx.message.body,
      from: config.fromNumber,
      messagingServiceSid: config.messagingServiceSid,
      statusCallback,
    });
    return { providerMessageId: res.sid || null, rawResponse: res };
  }

  private async verify(req: IncomingWebhookRequest, channel: ChannelRow): Promise<InboundBatch> {
    const config = jsonbToStored(channel.config);
    const params = parseUrlEncoded(req.rawBody);
    const url = reconstructWebhookUrl({
      headers: req.headers,
      pathWithQuery: `/api/v1/conversations/channels/${channel.id}/webhook`,
      fallbackBase: process.env.MUNIN_MCP_URL,
    });
    const authToken = await this.client.loadAuthToken(config.encryptedAuthToken);
    const signature = headerOne(req.headers, 'x-twilio-signature') ?? '';
    if (!validateTwilioSignature({ authToken, url, params, signature })) {
      throw new Error('twilio_signature_invalid');
    }

    if (params.MessageStatus) {
      await this.applyStatusCallback(channel, params);
      return { messages: [] };
    }

    if (!params.MessageSid || !params.From || !params.Body) {
      return { messages: [] };
    }

    const attachments = collectMedia(params);
    const raw: Record<string, unknown> = { ...params };
    if (attachments.length > 0) raw.attachments = attachments;

    return {
      messages: [
        {
          fromIdentity: { phone: params.From },
          body: params.Body,
          providerMessageId: params.MessageSid,
          receivedAt: new Date(),
          raw,
        },
      ],
    };
  }

  private async applyStatusCallback(channel: ChannelRow, params: Record<string, string>): Promise<void> {
    const sid = params.MessageSid;
    if (!sid) return;
    const status = mapTwilioStatus(params.MessageStatus);
    if (!status) return;
    const error =
      params.ErrorCode || params.ErrorMessage
        ? `twilio_${params.ErrorCode ?? 'err'}${params.ErrorMessage ? `: ${params.ErrorMessage}` : ''}`
        : null;
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`);
      const update: Record<string, unknown> = {
        status,
        updatedAt: new Date(),
      };
      if (status === 'sent') update.sentAt = new Date();
      if (error) update.error = error;
      await tx
        .update(schema.convMessageDeliveries)
        .set(update)
        .where(eq(schema.convMessageDeliveries.messageIdHeader, sid));
    });
    this.logger.log(`twilio status callback sid=${sid} status=${params.MessageStatus} → ${status}`);
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

function mapTwilioStatus(status: string | undefined): 'queued' | 'sent' | 'failed' | null {
  switch (status) {
    case 'sent':
    case 'delivered':
      return 'sent';
    case 'failed':
    case 'undelivered':
      return 'failed';
    case 'queued':
    case 'sending':
    case 'accepted':
    case 'scheduled':
      return 'queued';
    default:
      return null;
  }
}

function collectMedia(params: Record<string, string>): Array<{ url: string; contentType: string }> {
  const numMedia = parseInt(params.NumMedia ?? '0', 10) || 0;
  const out: Array<{ url: string; contentType: string }> = [];
  for (let i = 0; i < numMedia; i++) {
    const url = params[`MediaUrl${i}`];
    const ct = params[`MediaContentType${i}`];
    if (url) out.push({ url, contentType: ct ?? 'application/octet-stream' });
  }
  return out;
}

function buildWebhookUrl(channelId: string): string | undefined {
  const base = process.env.MUNIN_MCP_URL?.replace(/\/$/, '');
  if (!base) return undefined;
  return `${base}/api/v1/conversations/channels/${channelId}/webhook`;
}
