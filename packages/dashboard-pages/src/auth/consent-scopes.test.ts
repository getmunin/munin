import { describe, expect, it } from 'vitest';
import { SUPPORTED_SCOPES } from '@getmunin/types';
import en from '../messages/en.json';
import nb from '../messages/nb.json';
import {
  CONSENT_MODULE_ORDER,
  countConsentScopes,
  groupConsentScopes,
  isHiddenConsentScope,
} from './consent-scopes';

const LOCALES = { en, nb } as const;

const visibleScopes = SUPPORTED_SCOPES.filter((scope) => !isHiddenConsentScope(scope));
const visiblePrefixes = [...new Set(visibleScopes.map((scope) => scope.split(':', 1)[0]!))];

describe('consent scope grouping', () => {
  it('renders a card for every scope the resource metadata advertises', () => {
    const groups = groupConsentScopes(SUPPORTED_SCOPES);
    expect(groups.every((g) => g.described)).toBe(true);
    expect(groups.map((g) => g.module).sort()).toEqual([...visiblePrefixes].sort());
  });

  it('counts every granted scope, not one per read/write pill', () => {
    const groups = groupConsentScopes(SUPPORTED_SCOPES);
    expect(countConsentScopes(groups)).toBe(visibleScopes.length);
  });

  it('shows an unrecognised scope rather than dropping it', () => {
    const groups = groupConsentScopes(['kb:read', 'billing:read', 'billing:refund']);
    const billing = groups.find((g) => g.module === 'billing');
    expect(billing).toEqual({
      module: 'billing',
      described: false,
      read: true,
      write: false,
      scopes: ['billing:read', 'billing:refund'],
    });
    expect(countConsentScopes(groups)).toBe(3);
  });

  it('hides sign-in and MCP plumbing scopes, org markers included', () => {
    const groups = groupConsentScopes([
      'openid',
      'profile',
      'email',
      'offline_access',
      'identity:read',
      'mcp:tools',
      'mcp:admin',
      'mcp:org:org_123',
    ]);
    expect(groups).toEqual([]);
  });

  it.each(Object.entries(LOCALES))('%s names and describes every module', (_locale, messages) => {
    const consent = messages.dashboard.oauthConsent as {
      modules: Record<string, string>;
      moduleDescriptions: Record<string, { read: string; readWrite: string }>;
      undescribedScopes: string;
    };
    for (const module of CONSENT_MODULE_ORDER) {
      expect(consent.modules[module]).toBeTruthy();
      expect(consent.moduleDescriptions[module]?.read).toBeTruthy();
      expect(consent.moduleDescriptions[module]?.readWrite).toBeTruthy();
    }
    expect(consent.undescribedScopes).toContain('{scopes}');
  });
});
