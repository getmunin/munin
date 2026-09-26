import { describe, expect, it } from 'vitest';
import { PII_RAW_SCOPE } from '@getmunin/types';
import { PSEUDONYMIZED_KEY_SCOPES, keySeesRawPersonalData, scopesForNewKey } from './api-key-scopes';

describe('API key scopes', () => {
  it('mints a pseudonymized key with every scope except raw personal data', () => {
    const scopes = scopesForNewKey(true);
    expect(scopes).not.toContain('*');
    expect(scopes).not.toContain(PII_RAW_SCOPE);
    expect(scopes).toContain('conv:read');
    expect(scopes).toEqual([...PSEUDONYMIZED_KEY_SCOPES]);
    expect(keySeesRawPersonalData(scopes)).toBe(false);
  });

  it('mints a raw key as a wildcard, which includes raw personal data', () => {
    expect(scopesForNewKey(false)).toEqual(['*']);
    expect(keySeesRawPersonalData(['*'])).toBe(true);
    expect(keySeesRawPersonalData(['conv:read', PII_RAW_SCOPE])).toBe(true);
  });
});
