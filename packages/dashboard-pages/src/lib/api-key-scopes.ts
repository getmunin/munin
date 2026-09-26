import { PII_RAW_SCOPE, SUPPORTED_SCOPES } from '@getmunin/types';

export const PSEUDONYMIZED_KEY_SCOPES: readonly string[] = SUPPORTED_SCOPES.filter(
  (scope) => scope !== PII_RAW_SCOPE,
);

export function scopesForNewKey(pseudonymize: boolean): string[] {
  return pseudonymize ? [...PSEUDONYMIZED_KEY_SCOPES] : ['*'];
}

export function keySeesRawPersonalData(scopes: readonly string[]): boolean {
  return scopes.includes('*') || scopes.includes(PII_RAW_SCOPE);
}
