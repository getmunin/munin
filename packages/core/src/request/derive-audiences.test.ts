import { describe, expect, it } from 'vitest';
import { deriveAudiencesFromScopes } from './credentials.ts';

describe('deriveAudiencesFromScopes', () => {
  it('grants admin only when mcp:admin is present', () => {
    expect(deriveAudiencesFromScopes(['mcp:admin'])).toEqual(['admin']);
    expect(deriveAudiencesFromScopes(['mcp:admin', 'kb:read'])).toEqual(['admin']);
  });

  it('grants self_service only when mcp:self_service is present', () => {
    expect(deriveAudiencesFromScopes(['mcp:self_service'])).toEqual(['self_service']);
  });

  it('grants both when both mcp:* scopes are present', () => {
    expect(deriveAudiencesFromScopes(['mcp:admin', 'mcp:self_service']).sort()).toEqual(
      ['admin', 'self_service'].sort(),
    );
  });

  it('returns an empty list for OIDC-only or resource-scope-only tokens', () => {
    expect(deriveAudiencesFromScopes(['openid'])).toEqual([]);
    expect(deriveAudiencesFromScopes(['openid', 'profile', 'email'])).toEqual([]);
    expect(deriveAudiencesFromScopes(['kb:read', 'crm:write'])).toEqual([]);
  });

  it('returns an empty list for an empty scope set', () => {
    expect(deriveAudiencesFromScopes([])).toEqual([]);
  });
});
