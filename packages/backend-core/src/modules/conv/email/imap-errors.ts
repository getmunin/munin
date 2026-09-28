import type { PollFailureKind } from '../channels/adapter.ts';

const PERMANENT_RESPONSE_CODES = new Set([
  'AUTHENTICATIONFAILED',
  'AUTHORIZATIONFAILED',
  'EXPIRED',
  'NONEXISTENT',
]);

export function classifyImapError(err: unknown): PollFailureKind {
  if (typeof err !== 'object' || err === null) return 'transient';
  if ('authenticationFailed' in err && err.authenticationFailed === true) return 'permanent';
  if (
    'serverResponseCode' in err &&
    typeof err.serverResponseCode === 'string' &&
    PERMANENT_RESPONSE_CODES.has(err.serverResponseCode.toUpperCase())
  ) {
    return 'permanent';
  }
  return 'transient';
}
