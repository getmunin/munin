import { Controller, HttpCode, Logger, Post, Req, Res } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request, Response } from 'express';
import { describeError } from '@getmunin/core';
import { SlackInboundService } from './slack-inbound.service.ts';
import { verifySlackSignature } from './slack-signature.ts';
import { readSlackSigningSecret } from './slack.constants.ts';

/**
 * Public Slack Events API receiver. Signature-verified against the raw body,
 * then acked immediately — Slack retries on slow acks (>3s), which would
 * double-deliver — and processed out-of-band. Dedup is anchored on the
 * (channel, ts) unique index in slack_message_links, so a redelivered event
 * can never produce a second customer message.
 */
@Controller('v1/slack')
export class SlackEventsController {
  private readonly logger = new Logger(SlackEventsController.name);

  constructor(private readonly inbound: SlackInboundService) {}

  @Post('events')
  @HttpCode(200)
  handle(@Req() req: RawBodyRequest<Request>, @Res() res: Response): void {
    const signingSecret = readSlackSigningSecret();
    if (!signingSecret) {
      res.status(503).send('slack app not configured');
      return;
    }
    const rawBody = req.rawBody ?? Buffer.alloc(0);
    const verified = verifySlackSignature({
      signingSecret,
      timestamp: req.headers['x-slack-request-timestamp'],
      signature: req.headers['x-slack-signature'],
      rawBody,
    });
    if (!verified) {
      res.status(401).send('invalid signature');
      return;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch {
      res.status(400).send('invalid json');
      return;
    }
    if (payload === null || typeof payload !== 'object') {
      res.status(400).send('invalid payload');
      return;
    }
    const body = payload as Record<string, unknown>;

    if (body.type === 'url_verification') {
      res.json({ challenge: typeof body.challenge === 'string' ? body.challenge : '' });
      return;
    }

    res.status(200).send();
    if (body.type === 'event_callback') {
      void this.inbound.processEventCallback(body).catch((err: unknown) => {
        this.logger.error(`slack event processing failed: ${describeError(err)}`);
      });
    }
  }
}
