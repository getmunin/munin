import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import type { ResolvedCredential } from '@getmunin/core';
import { PublicThrottlerGuard } from '../../../common/rate-limit/public-throttler.guard.ts';

@Injectable()
export class WidgetThrottlerGuard extends PublicThrottlerGuard {
  protected override getTracker(req: Request): Promise<string> {
    const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
    const channelId = readField(req, 'channelId') ?? '-';
    const apiKeyId = readApiKeyId(req) ?? '-';
    return Promise.resolve(`widget:${apiKeyId}|${channelId}|${ip}`);
  }
}

function readField(req: Request, name: string): string | null {
  const body = req.body as Record<string, unknown> | undefined;
  if (body && typeof body[name] === 'string') return body[name];
  const query = req.query as Record<string, unknown> | undefined;
  if (query && typeof query[name] === 'string') return query[name];
  return null;
}

function readApiKeyId(req: Request): string | null {
  const credential = (req as Request & { credential?: ResolvedCredential }).credential;
  return credential?.actor.id ?? null;
}
