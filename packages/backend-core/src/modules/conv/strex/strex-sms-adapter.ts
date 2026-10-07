import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
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
} from '../channels/adapter.ts';
import {
  STREX_SIGNATURE_HEADER,
  StrexClientService,
  buildStrexWebhookUrl,
  mapStrexDeliveryReport,
  parseStrexSignatureHeader,
  verifyStrexSignature,
} from './strex-client.service.ts';
import { jsonbToStored } from './strex-sms.service.ts';

@Injectable()
export class StrexSmsAdapter implements ChannelAdapter {
  readonly kind = 'sms' as const;
  readonly vendors = ['strex'] as const;

  private readonly logger = new Logger(StrexSmsAdapter.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(StrexClientService) private readonly client: StrexClientService,
  ) {}

  readonly inbound: InboundMode = {
    mode: 'webhook',
    verify: (req, channel) => this.verify(req, channel),
    toResponse: () => ({ status: 200 }),
  };

  async send(ctx: SendContext): Promise<SendResult> {
    const config = jsonbToStored(ctx.channel.config);
    const to = ctx.contact?.phone;
    if (!to) throw new Error('strex_send_missing_recipient_phone');
    const apiKey = await this.client.loadSecret(config.encryptedApiKey);
    const res = await this.client.sendSms(
      { apiKey, environment: config.environment },
      {
        transactionId: ctx.delivery.id,
        sender: config.sender,
        recipient: ensurePlus(to),
        content: ctx.message.body,
        deliveryReportUrl: buildStrexWebhookUrl(ctx.channel.id),
      },
    );
    return { providerMessageId: res.transactionId };
  }

  private async verify(req: IncomingWebhookRequest, channel: ChannelRow): Promise<InboundBatch> {
    const config = jsonbToStored(channel.config);
    const header = headerOne(req.headers, STREX_SIGNATURE_HEADER);
    if (!header) throw new Error('strex_signature_missing');
    const signature = parseStrexSignatureHeader(header);
    if (!signature) throw new Error('strex_signature_malformed');
    const apiKey = await this.client.loadSecret(config.encryptedApiKey);
    const publicKey = await this.client.serverPublicKey(
      { apiKey, environment: config.environment },
      signature.keyName,
    );
    const verified = verifyStrexSignature({
      publicKey,
      signature,
      method: 'POST',
      uri: buildStrexWebhookUrl(channel.id),
      rawBody: req.rawBody,
    });
    if (!verified.ok) throw new Error(`strex_${verified.error}`);

    const payload = parseJsonObject(req.rawBody);
    if (!payload) return { messages: [] };

    if (typeof payload.statusCode === 'string') {
      await this.applyDeliveryReport(channel, payload);
      return { messages: [] };
    }

    const transactionId = stringField(payload.transactionId);
    const sender = stringField(payload.sender);
    const content = typeof payload.content === 'string' ? payload.content : null;
    if (!transactionId || !sender || content === null) return { messages: [] };

    const created = stringField(payload.created);
    const receivedAt = created ? new Date(created) : new Date();

    return {
      messages: [
        {
          fromIdentity: { phone: ensurePlus(sender) },
          body: content,
          providerMessageId: transactionId,
          receivedAt: Number.isNaN(receivedAt.getTime()) ? new Date() : receivedAt,
          optOut: payload.isStopMessage === true,
          raw: payload,
        },
      ],
    };
  }

  private async applyDeliveryReport(
    channel: ChannelRow,
    report: Record<string, unknown>,
  ): Promise<void> {
    const transactionId = stringField(report.transactionId);
    if (!transactionId) return;
    const mapped = mapStrexDeliveryReport(report);
    if (!mapped) return;
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`);
      const update: Record<string, unknown> = { status: mapped.status, updatedAt: new Date() };
      if (mapped.status === 'sent') update.sentAt = new Date();
      if (mapped.error) update.error = mapped.error;
      await tx
        .update(schema.convMessageDeliveries)
        .set(update)
        .where(
          and(
            eq(schema.convMessageDeliveries.orgId, channel.orgId),
            eq(schema.convMessageDeliveries.channelId, channel.id),
            eq(schema.convMessageDeliveries.messageIdHeader, transactionId),
          ),
        );
    });
    this.logger.log(
      `strex delivery report id=${transactionId} status=${String(report.statusCode)}/${String(report.detailedStatusCode)} → ${mapped.status}`,
    );
  }
}

function parseJsonObject(rawBody: Buffer): Record<string, unknown> | null {
  try {
    const json = JSON.parse(rawBody.toString('utf8')) as unknown;
    return json && typeof json === 'object' && !Array.isArray(json)
      ? (json as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function stringField(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function headerOne(
  headers: Record<string, string | string[] | undefined>,
  key: string,
): string | undefined {
  const v = headers[key.toLowerCase()];
  if (Array.isArray(v)) return v[0];
  return v;
}

function ensurePlus(msisdn: string): string {
  return msisdn.startsWith('+') ? msisdn : `+${msisdn}`;
}
