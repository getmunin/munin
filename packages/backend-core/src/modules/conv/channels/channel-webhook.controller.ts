import {
  Controller,
  HttpException,
  HttpStatus,
  Inject,
  Logger,
  Param,
  Post,
  Req,
  Res,
  type RawBodyRequest,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { schema, type Db } from '@getmunin/db';
import { and, eq, isNull } from 'drizzle-orm';
import { DB } from '../../../common/db/db.module.ts';
import {
  CHANNEL_ADAPTERS,
  ChannelAdapterRegistry,
  type ChannelAdapter,
  type ChannelRow,
  type IncomingWebhookRequest,
  type InboundBatch,
} from './adapter.ts';
import { ChannelIngestService } from './channel-ingest.service.ts';

@Controller('api/v1/conversations/channels')
export class ChannelWebhookController {
  private readonly logger = new Logger(ChannelWebhookController.name);
  private readonly registry: ChannelAdapterRegistry;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CHANNEL_ADAPTERS) adapters: ChannelAdapter[],
    @Inject(ChannelIngestService) private readonly ingest: ChannelIngestService,
  ) {
    this.registry = new ChannelAdapterRegistry(adapters);
  }

  @Post(':channelId/webhook')
  async receive(
    @Param('channelId') channelId: string,
    @Req() req: RawBodyRequest<Request>,
    @Res() res: Response,
  ): Promise<void> {
    const channel = await this.loadChannel(channelId);
    if (!channel) {
      throw new HttpException('channel not found', HttpStatus.NOT_FOUND);
    }
    const adapter = this.registry.get(channel.type, channel.vendor);
    if (!adapter || adapter.inbound?.mode !== 'webhook') {
      throw new HttpException(
        `channel '${channel.type}:${channel.vendor}' is not webhook-mode`,
        HttpStatus.BAD_REQUEST,
      );
    }

    const incoming: IncomingWebhookRequest = {
      headers: req.headers,
      rawBody: req.rawBody ?? Buffer.alloc(0),
      query: req.query as Record<string, string | string[] | undefined>,
    };

    let batch: InboundBatch;
    try {
      batch = await adapter.inbound.verify(incoming, channel);
    } catch (err) {
      this.logger.warn(
        `webhook verify failed channel=${channel.id} (${channel.type}:${channel.vendor}): ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new HttpException('webhook verification failed', HttpStatus.UNAUTHORIZED);
    }

    if (batch.messages.length > 0) {
      await this.ingest.ingest(channel, batch);
    }

    const response = batch.responseOverride ?? adapter.inbound.toResponse?.(batch, channel);
    if (response) {
      res.status(response.status);
      if (response.contentType) res.setHeader('content-type', response.contentType);
      res.send(response.body ?? '');
      return;
    }
    res.status(204).send();
  }

  private async loadChannel(channelId: string): Promise<ChannelRow | null> {
    const rows = await this.db
      .select()
      .from(schema.convChannels)
      .where(
        and(
          eq(schema.convChannels.id, channelId),
          eq(schema.convChannels.active, true),
          isNull(schema.convChannels.archivedAt),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }
}
