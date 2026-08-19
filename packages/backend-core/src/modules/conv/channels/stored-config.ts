import {
  CallHandler,
  ExecutionContext,
  Injectable,
  InternalServerErrorException,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, catchError, throwError } from 'rxjs';
import type { z } from 'zod';

export class ChannelConfigInvalidError extends Error {
  readonly code = 'conv_channel_config_invalid';
  readonly fieldErrors: ReadonlyArray<{ field: string; message: string }>;

  constructor(kind: string, fieldErrors: ReadonlyArray<{ field: string; message: string }>) {
    const fields = fieldErrors.map((fe) => fe.field).join(', ');
    super(
      `conv_channel_config_invalid: this ${kind} channel's saved settings are incomplete (${fields}) — open the channel and save its settings again to repair it`,
    );
    this.fieldErrors = fieldErrors;
  }
}

export function parseStoredConfig<T extends z.ZodType>(
  schema: T,
  json: Record<string, unknown>,
  kind: string,
): z.infer<T> {
  const parsed = schema.safeParse(json);
  if (parsed.success) return parsed.data;
  throw new ChannelConfigInvalidError(kind, toFieldErrors(parsed.error));
}

export function tryParseStoredConfig<T extends z.ZodType>(
  schema: T,
  json: Record<string, unknown>,
): z.infer<T> | null {
  const parsed = schema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

function toFieldErrors(error: z.ZodError): Array<{ field: string; message: string }> {
  const seen = new Set<string>();
  const out: Array<{ field: string; message: string }> = [];
  for (const issue of error.issues) {
    const field = issue.path.join('.') || 'config';
    if (seen.has(field)) continue;
    seen.add(field);
    out.push({ field, message: issue.message });
  }
  return out;
}

@Injectable()
export class ChannelConfigErrorInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      catchError((err: unknown) =>
        throwError(() =>
          err instanceof ChannelConfigInvalidError
            ? new InternalServerErrorException({
                message: err.message,
                code: err.code,
                fieldErrors: err.fieldErrors,
              })
            : err,
        ),
      ),
    );
  }
}
