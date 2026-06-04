import { CanActivate, ExecutionContext, HttpException, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { parseEnvInt, type ResolvedCredential } from '@getmunin/core';

interface Window {
  count: number;
  resetAt: number;
}

const WINDOW_MS = 60_000;

/**
 * Per-replica burst limiter for /mcp. Each pod keeps its own (org || ip) →
 * (count, resetAt) map in memory; entries auto-expire at the end of their
 * minute window. Multi-replica fleets don't enforce a global cap — each
 * pod independently allows up to `MUNIN_MCP_BURST_PER_MIN` (default 60).
 * Adequate for runaway-agent protection; deliberately not a billing gate.
 */
@Injectable()
export class McpBurstGuard implements CanActivate {
  private readonly windows = new Map<string, Window>();

  canActivate(context: ExecutionContext): boolean {
    const limit = parseEnvInt({ name: 'MUNIN_MCP_BURST_PER_MIN', default: 60 });
    if (limit <= 0) return true;

    const req = context.switchToHttp().getRequest<Request & { credential?: ResolvedCredential }>();
    const orgId = req.credential?.actor.orgId;
    const ip = req.ip ?? req.socket?.remoteAddress;
    const key = orgId ? `org:${orgId}` : `ip:${ip ?? 'unknown'}`;

    const now = Date.now();
    const existing = this.windows.get(key);
    if (!existing || existing.resetAt <= now) {
      this.windows.set(key, { count: 1, resetAt: now + WINDOW_MS });
      this.sweep(now);
      return true;
    }
    if (existing.count >= limit) {
      const retryAfter = Math.ceil((existing.resetAt - now) / 1000);
      throw new HttpException(
        {
          statusCode: 429,
          code: 'mcp_burst_limited',
          message: `mcp_burst_limited: exceeded ${limit} MCP calls per minute on this replica. Retry in ${retryAfter}s.`,
          retryAfter,
        },
        429,
      );
    }
    existing.count += 1;
    return true;
  }

  private sweep(now: number): void {
    if (this.windows.size < 1024) return;
    for (const [key, w] of this.windows) {
      if (w.resetAt <= now) this.windows.delete(key);
    }
  }
}
