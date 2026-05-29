import {
  CallHandler,
  ExecutionContext,
  Inject,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, from, mergeMap } from 'rxjs';
import { getCurrentContext } from '@getmunin/core';
import { QUOTAS_SERVICE, type QuotasService } from './quotas.service.ts';

/**
 * Counts `/v1` REST traffic toward the org's call quota. Runs inside the
 * tenancy transaction (via getCurrentContext()) so the cloud override's
 * counter upsert lives in the same Postgres tx as the request's work; if
 * the handler errors after the upsert, the counter rolls back with it.
 *
 * Default `QuotasService` no-ops `recordCall`, so this is a free pass on
 * OSS — only registered globally so cloud's overridden provider gets
 * called without touching every controller's @UseInterceptors line.
 *
 * Skips routes without a tenancy context (anonymous endpoints) and the
 * `/mcp` controller, which has its own per-tool seam through the
 * dispatcher's rateLimit hook.
 */
@Injectable()
export class CallQuotaInterceptor implements NestInterceptor {
  constructor(@Inject(QUOTAS_SERVICE) private readonly quotas: QuotasService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    try {
      getCurrentContext();
    } catch {
      return next.handle();
    }

    const request = context
      .switchToHttp()
      .getRequest<{ method: string; url: string; route?: { path?: string } }>();
    const path = request.url.split('?')[0] ?? request.url;
    if (path === '/mcp' || path.startsWith('/mcp/')) {
      return next.handle();
    }
    const verb = request.method.toUpperCase();
    if (verb === 'HEAD' || verb === 'OPTIONS') {
      return next.handle();
    }

    const route = request.route?.path ?? path;
    const key = `${verb} ${route}`;
    return from(this.quotas.recordCall('api_request', key)).pipe(
      mergeMap(() => next.handle()),
    );
  }
}
