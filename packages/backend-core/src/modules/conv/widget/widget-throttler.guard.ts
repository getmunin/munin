import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';
import type { ResolvedCredential } from '@getmunin/core';

/**
 * Tracker key for widget POSTs / GETs.
 *
 * Key shape: `widget:<apiKeyId>|<channelId>|<ip>`.
 *
 * sessionId is *not* part of the key. It's caller-controlled — a hostile
 * embed can rotate session IDs ad infinitum, so including it lets a flood
 * trivially defeat the per-session bucket. Limiting per (apiKey, channel,
 * ip) means even a session-rotating flood from one source hits the cap.
 *
 * IP comes from `req.ip`, which uses Express's `trust proxy` setting
 * (configured at bootstrap from `MUNIN_TRUST_PROXY`). Trusting raw
 * `x-forwarded-for` was wrong: without a proxy in front, any client can
 * spoof it.
 */
@Injectable()
export class WidgetThrottlerGuard extends ThrottlerGuard {
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
