import { describe, it, expect } from 'vitest';
import {
  hasSessionCookie,
  isSetupGatedPath,
  isSetupIncomplete,
  setupPathFor,
  type MembershipDto,
} from './setup-gate';

function membership(overrides: Partial<MembershipDto> = {}): MembershipDto {
  return { orgId: 'org_1', name: 'Acme', role: 'owner', isDefault: true, ...overrides };
}

describe('isSetupGatedPath', () => {
  it('gates the dashboard root of every supported locale', () => {
    expect(isSetupGatedPath('/en/dashboard')).toBe(true);
    expect(isSetupGatedPath('/nb/dashboard')).toBe(true);
    expect(isSetupGatedPath('/en/dashboard/')).toBe(true);
  });

  it('leaves dashboard subpages to the client-side gate', () => {
    expect(isSetupGatedPath('/en/dashboard/settings')).toBe(false);
    expect(isSetupGatedPath('/en/dashboard/account')).toBe(false);
    expect(isSetupGatedPath('/en/dashboard/oauth/consent')).toBe(false);
  });

  it('ignores paths that only look like the dashboard root', () => {
    expect(isSetupGatedPath('/dashboard')).toBe(false);
    expect(isSetupGatedPath('/de/dashboard')).toBe(false);
    expect(isSetupGatedPath('/en/dashboards')).toBe(false);
    expect(isSetupGatedPath('/en/setup')).toBe(false);
    expect(isSetupGatedPath('/en/login')).toBe(false);
  });
});

describe('setupPathFor', () => {
  it('keeps the locale prefix of the request', () => {
    expect(setupPathFor('/en/dashboard')).toBe('/en/setup');
    expect(setupPathFor('/nb/dashboard')).toBe('/nb/setup');
    expect(setupPathFor('/en/dashboard/')).toBe('/en/setup');
  });
});

describe('hasSessionCookie', () => {
  it('detects the session cookie whatever prefix it carries', () => {
    expect(hasSessionCookie('better-auth.session_token=abc')).toBe(true);
    expect(hasSessionCookie('__Secure-better-auth.session_token=abc; munin_locale=en')).toBe(true);
  });

  it('is false without one', () => {
    expect(hasSessionCookie('')).toBe(false);
    expect(hasSessionCookie('munin_locale=en')).toBe(false);
  });
});

describe('isSetupIncomplete', () => {
  it('is true for an owner whose org has no name', () => {
    expect(isSetupIncomplete({ providerConfigured: true }, [membership({ name: '' })])).toBe(true);
    expect(isSetupIncomplete({ providerConfigured: true }, [membership({ name: '   ' })])).toBe(true);
  });

  it('is true for an owner with no LLM provider configured', () => {
    expect(isSetupIncomplete({ providerConfigured: false }, [membership()])).toBe(true);
  });

  it('is true for an admin, not just an owner', () => {
    expect(
      isSetupIncomplete({ providerConfigured: true }, [membership({ role: 'admin', name: '' })]),
    ).toBe(true);
  });

  it('is false once the org is named and a provider is configured', () => {
    expect(isSetupIncomplete({ providerConfigured: true }, [membership()])).toBe(false);
  });

  it('never redirects a non-admin member', () => {
    expect(
      isSetupIncomplete({ providerConfigured: false }, [membership({ role: 'member', name: '' })]),
    ).toBe(false);
    expect(
      isSetupIncomplete({ providerConfigured: false }, [membership({ role: 'weird', name: '' })]),
    ).toBe(false);
  });

  it('falls through when either read failed or returned nothing', () => {
    expect(isSetupIncomplete(null, [membership({ name: '' })])).toBe(false);
    expect(isSetupIncomplete({ providerConfigured: false }, null)).toBe(false);
    expect(isSetupIncomplete({ providerConfigured: false }, [])).toBe(false);
  });

  it('reads the default membership rather than the first row', () => {
    const rows = [
      membership({ orgId: 'org_other', name: 'Named', isDefault: false }),
      membership({ orgId: 'org_active', name: '', isDefault: true }),
    ];
    expect(isSetupIncomplete({ providerConfigured: true }, rows)).toBe(true);
  });
});
