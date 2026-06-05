import { Injectable } from '@nestjs/common';

export const ERROR_REPORTER = Symbol('ERROR_REPORTER');

export interface ErrorReporterContext {
  tool?: string;
  actor?: { type?: string | null; id?: string | null; orgId?: string | null } | null;
  args?: Record<string, unknown> | null;
}

export abstract class ErrorReporter {
  abstract captureException(error: unknown, context?: ErrorReporterContext): void;
}

@Injectable()
export class NoopErrorReporter extends ErrorReporter {
  captureException(_error: unknown, _context?: ErrorReporterContext): void {}
}
