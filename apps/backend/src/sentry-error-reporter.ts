import { Injectable } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { ErrorReporter, type ErrorReporterContext } from '@getmunin/backend-core';

@Injectable()
export class SentryErrorReporter extends ErrorReporter {
  captureException(error: unknown, context?: ErrorReporterContext): void {
    Sentry.withScope((scope) => {
      if (context?.tool) scope.setTag('mcp.tool', context.tool);
      if (context?.actor?.type) scope.setTag('mcp.actor_type', context.actor.type);
      if (context?.actor?.orgId) scope.setTag('mcp.org_id', context.actor.orgId);
      if (context?.actor?.id) scope.setUser({ id: context.actor.id });
      if (context?.args) scope.setContext('mcp_args', context.args);
      Sentry.captureException(toError(error));
    });
  }
}

function toError(value: unknown): Error {
  if (value instanceof Error) return value;
  if (typeof value === 'string') return new Error(value);
  try {
    return new Error(JSON.stringify(value));
  } catch {
    return new Error(String(value));
  }
}
