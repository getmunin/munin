import {
  CallHandler,
  ExecutionContext,
  Inject,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, catchError, from, mergeMap, throwError } from 'rxjs';
import { AuditLogger, getCurrentContext } from '@getmunin/core';
import { RateLimitService } from '../rate-limit/rate-limit.service.ts';

const POLLING_GET_PREFIXES = [
  '/agent-health',
  '/agent-config',
  '/widget/messages',
  '/widget/conversations',
  '/inbox',
  '/usage/summary',
  '/system/alerts',
];

function stripVersionPrefix(path: string): string {
  if (path.startsWith('/api/v1/') || path === '/api/v1') return path.slice(7);
  if (path.startsWith('/v1/') || path === '/v1') return path.slice(3);
  return path;
}

function isPollingGet(path: string): boolean {
  const stripped = stripVersionPrefix(path);
  return POLLING_GET_PREFIXES.some(
    (p) => stripped === p || stripped.startsWith(`${p}/`),
  );
}

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly audit = new AuditLogger();

  constructor(
    @Inject(RateLimitService) private readonly rateLimit: RateLimitService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    let hasContext = true;
    try {
      getCurrentContext();
    } catch {
      hasContext = false;
    }
    if (!hasContext) return next.handle();

    const request = context
      .switchToHttp()
      .getRequest<{
        method: string;
        url: string;
        headers: Record<string, string | string[] | undefined>;
        _auditRecorded?: boolean;
      }>();
    if (request._auditRecorded) return next.handle();
    request._auditRecorded = true;
    const verb = request.method.toUpperCase();
    const path = request.url.split('?')[0] ?? request.url;
    const method = `${verb} ${path}`;
    const startedAt = Date.now();

    if (verb === 'HEAD' || verb === 'OPTIONS') {
      return next.handle();
    }
    if (verb === 'GET' && path === '/mcp') {
      return next.handle();
    }
    if (verb === 'GET' && isPollingGet(path)) {
      return next.handle();
    }

    const rawUa = request.headers['user-agent'];
    const userAgent = Array.isArray(rawUa) ? rawUa[0] : rawUa;
    const actor = getCurrentContext().actor;
    const countApiCall = actor?.type !== 'user' && !path.startsWith('/mcp');

    const recordApiCall = async (): Promise<void> => {
      try {
        await this.rateLimit.record('api_calls_day');
      } catch (err) {
        console.error('[audit] failed to bump api_calls_day:', err);
      }
    };

    return next.handle().pipe(
      mergeMap(async (value: unknown) => {
        await this.audit.record({
          method,
          result: 'ok',
          durationMs: Date.now() - startedAt,
          userAgent,
        });
        if (countApiCall) await recordApiCall();
        return value;
      }),
      catchError((err: unknown) =>
        from(
          (async () => {
            await this.audit.record({
              method,
              result: 'error',
              error: err instanceof Error ? err.message : String(err),
              durationMs: Date.now() - startedAt,
              userAgent,
            });
            if (countApiCall) await recordApiCall();
          })(),
        ).pipe(mergeMap(() => throwError(() => err))),
      ),
    );
  }
}
