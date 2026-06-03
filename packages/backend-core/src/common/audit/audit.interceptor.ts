import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, catchError, from, mergeMap, throwError } from 'rxjs';
import { AuditLogger, getCurrentContext } from '@getmunin/core';

/**
 * Records every controller invocation as an audit row. Runs INSIDE the
 * tenancy transaction (via getCurrentContext()) so the audit row is
 * committed atomically with the request's other writes.
 *
 * Skips routes where there's no active request context (anonymous routes
 * that didn't open a transaction).
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly audit = new AuditLogger();

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

    const rawUa = request.headers['user-agent'];
    const userAgent = Array.isArray(rawUa) ? rawUa[0] : rawUa;

    return next.handle().pipe(
      mergeMap(async (value: unknown) => {
        await this.audit.record({
          method,
          result: 'ok',
          durationMs: Date.now() - startedAt,
          userAgent,
        });
        return value;
      }),
      catchError((err: unknown) =>
        from(
          this.audit.record({
            method,
            result: 'error',
            error: err instanceof Error ? err.message : String(err),
            durationMs: Date.now() - startedAt,
            userAgent,
          }),
        ).pipe(mergeMap(() => throwError(() => err))),
      ),
    );
  }
}
