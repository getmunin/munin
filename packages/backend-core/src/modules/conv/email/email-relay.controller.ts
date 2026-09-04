import {
  HttpException,
  HttpStatus,
  Inject,
  Logger,
  Post,
  Req,
  type RawBodyRequest,
} from '@nestjs/common';
import type { Request } from 'express';
import { verifyHmac } from '@getmunin/core';
import { PublicController } from '../../../common/auth/auth.guard.ts';
import {
  EMAIL_RELAY_CONTROLLER_PATH,
  EMAIL_RELAY_MAX_RAW_BYTES,
  EMAIL_RELAY_ROUTE,
  EMAIL_RELAY_SIGNATURE_HEADER,
} from './email-relay.constants.ts';
import { EmailRelayService, type RelayIngestOutcome } from './email-relay.service.ts';

@PublicController(EMAIL_RELAY_CONTROLLER_PATH)
export class EmailRelayController {
  private readonly logger = new Logger(EmailRelayController.name);

  constructor(@Inject(EmailRelayService) private readonly relay: EmailRelayService) {}

  @Post(EMAIL_RELAY_ROUTE)
  async receive(@Req() req: RawBodyRequest<Request>): Promise<{ status: string }> {
    const secret = process.env.MUNIN_EMAIL_RELAY_SECRET;
    if (!secret) {
      throw new HttpException('relay not configured', HttpStatus.NOT_FOUND);
    }

    const rawBody = req.rawBody ?? Buffer.alloc(0);
    const signature = headerOne(req.headers[EMAIL_RELAY_SIGNATURE_HEADER]);
    if (!signature || !verifyHmac(rawBody, secret, signature)) {
      throw new HttpException('relay signature invalid', HttpStatus.UNAUTHORIZED);
    }

    const payload = parsePayload(rawBody);
    if (!payload) {
      throw new HttpException('relay payload invalid', HttpStatus.BAD_REQUEST);
    }
    if (payload.raw.byteLength > EMAIL_RELAY_MAX_RAW_BYTES) {
      throw new HttpException('message too large', HttpStatus.PAYLOAD_TOO_LARGE);
    }

    const outcome = await this.relay.ingestRaw(payload);
    this.logger.log(`relay recipient=${payload.recipient} outcome=${outcome.status}`);
    return { status: describe(outcome) };
  }
}

function describe(outcome: RelayIngestOutcome): string {
  return outcome.status;
}

function headerOne(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function parsePayload(rawBody: Buffer): { recipient: string; raw: Buffer } | null {
  let body: unknown;
  try {
    body = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return null;
  }
  if (typeof body !== 'object' || body === null) return null;
  const { recipient, raw, rawEncoding } = body as {
    recipient?: unknown;
    raw?: unknown;
    rawEncoding?: unknown;
  };
  if (typeof recipient !== 'string' || !recipient.trim()) return null;
  if (typeof raw !== 'string' || !raw) return null;
  const encoding = rawEncoding === 'utf8' ? 'utf8' : 'base64';
  return { recipient, raw: Buffer.from(raw, encoding) };
}
