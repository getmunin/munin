import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { timingSafeEqual } from '@getmunin/core';
import { isPiiNerEnabled, readPiiWorkerSecrets } from './pii-config.ts';

interface RequestWithHeaders {
  headers: Record<string, string | string[] | undefined>;
}

@Injectable()
export class PiiWorkerGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const secrets = readPiiWorkerSecrets();
    if (!isPiiNerEnabled() || secrets.length === 0) {
      throw new ServiceUnavailableException(
        'pii_worker_disabled: set MUNIN_PII_NER_ENABLED and MUNIN_PII_WORKER_SECRET to accept annotation workers',
      );
    }
    const request = context.switchToHttp().getRequest<RequestWithHeaders>();
    const provided = readBearer(request.headers.authorization);
    let matched = false;
    for (const secret of secrets) {
      if (provided !== null && timingSafeEqual(provided, secret)) matched = true;
    }
    if (!matched) throw new UnauthorizedException('pii_worker_unauthorized: invalid worker secret');
    return true;
  }
}

function readBearer(header: string | string[] | undefined): string | null {
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed.toLowerCase().startsWith('bearer ')) return null;
  const token = trimmed.slice('bearer '.length).trim();
  return token.length > 0 ? token : null;
}
