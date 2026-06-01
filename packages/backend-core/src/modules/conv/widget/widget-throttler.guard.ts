import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';

@Injectable()
export class WidgetThrottlerGuard extends ThrottlerGuard {
  protected override getTracker(req: Request): Promise<string> {
    const ip = readIp(req);
    const channelId = readField(req, 'channelId') ?? '-';
    const sessionId = readField(req, 'sessionId') ?? readFirstSessionId(req) ?? '-';
    return Promise.resolve(`widget:${ip}|${channelId}|${sessionId}`);
  }
}

function readIp(req: Request): string {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) {
    const first = xff.split(',')[0]!.trim();
    if (first.length > 0) return first;
  }
  return req.ip ?? req.socket?.remoteAddress ?? 'unknown';
}

function readField(req: Request, name: string): string | null {
  const body = req.body as Record<string, unknown> | undefined;
  if (body && typeof body[name] === 'string') return body[name];
  const query = req.query as Record<string, unknown> | undefined;
  if (query && typeof query[name] === 'string') return query[name];
  return null;
}

function readFirstSessionId(req: Request): string | null {
  const query = req.query as Record<string, unknown> | undefined;
  const raw = query?.['sessionIds'];
  if (typeof raw !== 'string' || raw.length === 0) return null;
  const first = raw.split(',')[0]?.trim();
  return first && first.length > 0 ? first : null;
}
