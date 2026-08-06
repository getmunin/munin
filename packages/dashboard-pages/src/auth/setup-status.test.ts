import { describe, it, expect } from 'vitest';
import { isSetupIncomplete, type MembershipDto } from './setup-status';

function membership(overrides: Partial<MembershipDto> = {}): MembershipDto {
  return { orgId: 'org_1', name: 'Acme', role: 'owner', isDefault: true, ...overrides };
}

describe('isSetupIncomplete', () => {
  it('is true for an owner whose org has no name', () => {
    expect(isSetupIncomplete({ providerConfigured: true }, [membership({ name: '' })])).toBe(true);
    expect(isSetupIncomplete({ providerConfigured: true }, [membership({ name: '  ' })])).toBe(true);
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

  it('never diverts a non-admin member', () => {
    expect(
      isSetupIncomplete({ providerConfigured: false }, [membership({ role: 'member', name: '' })]),
    ).toBe(false);
  });

  it('falls through when either read failed or returned nothing', () => {
    expect(isSetupIncomplete(null, [membership({ name: '' })])).toBe(false);
    expect(isSetupIncomplete({ providerConfigured: false }, null)).toBe(false);
    expect(isSetupIncomplete({ providerConfigured: false }, [])).toBe(false);
  });

  it('reads the default membership rather than the first row', () => {
    expect(
      isSetupIncomplete({ providerConfigured: true }, [
        membership({ orgId: 'org_other', name: 'Named', isDefault: false }),
        membership({ orgId: 'org_active', name: '', isDefault: true }),
      ]),
    ).toBe(true);
  });
});
