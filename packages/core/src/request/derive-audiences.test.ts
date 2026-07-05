import { describe, expect, it } from 'vitest';
import { deriveAudiencesFromScopes, gateOauthGrantsByRole } from './credentials.ts';

describe('deriveAudiencesFromScopes', () => {
  it('grants admin only when mcp:admin is present', () => {
    expect(deriveAudiencesFromScopes(['mcp:admin'])).toEqual(['admin']);
    expect(deriveAudiencesFromScopes(['mcp:admin', 'kb:read'])).toEqual(['admin']);
  });

  it('ignores the retired mcp:self_service scope', () => {
    expect(deriveAudiencesFromScopes(['mcp:self_service'])).toEqual([]);
    expect(deriveAudiencesFromScopes(['mcp:admin', 'mcp:self_service'])).toEqual(['admin']);
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

describe('gateOauthGrantsByRole', () => {
  it('grants the admin audience to owners and admins', () => {
    for (const role of ['owner', 'admin']) {
      const granted = gateOauthGrantsByRole(['mcp:admin', 'kb:read'], role);
      expect(granted.scopes).toEqual(['mcp:admin', 'kb:read']);
      expect(granted.audiences).toEqual(['admin']);
    }
  });

  it('strips mcp:admin and the admin audience for members', () => {
    const granted = gateOauthGrantsByRole(['mcp:admin', 'kb:read'], 'member');
    expect(granted.scopes).toEqual(['kb:read']);
    expect(granted.audiences).toEqual([]);
  });

  it('strips mcp:admin for an unknown or missing role', () => {
    expect(gateOauthGrantsByRole(['mcp:admin'], null).scopes).toEqual([]);
    expect(gateOauthGrantsByRole(['mcp:admin'], undefined).audiences).toEqual([]);
    expect(gateOauthGrantsByRole(['mcp:admin'], 'viewer').audiences).toEqual([]);
  });

  it('leaves non-admin scopes untouched regardless of role', () => {
    expect(gateOauthGrantsByRole(['kb:read', 'crm:write'], 'member').scopes).toEqual([
      'kb:read',
      'crm:write',
    ]);
  });
});
