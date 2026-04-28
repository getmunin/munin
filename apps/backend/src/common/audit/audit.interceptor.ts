import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, catchError, tap, throwError } from 'rxjs';
import { AuditLogger, getCurrentContext } from '@munin/core';

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

    const request = context.switchToHttp().getRequest<{ method: string; url: string }>();
    const method = `${request.method} ${request.url.split('?')[0]}`;

    return next.handle().pipe(
      tap(() => {
        void this.audit.record({ method, result: 'ok' });
      }),
      catchError((err: unknown) => {
        void this.audit.record({
          method,
          result: 'error',
          error: err instanceof Error ? err.message : String(err),
        });
        return throwError(() => err);
      }),
    );
  }
}
