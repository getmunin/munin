import { describe, expect, it } from 'vitest';
import { endUserScopesForConnectorDomains } from './runner.service.ts';

describe('endUserScopesForConnectorDomains', () => {
  it('grants only base scopes when no connector is active', () => {
    const scopes = endUserScopesForConnectorDomains([]);
    expect(scopes).toEqual(['conv:read', 'conv:write', 'crm:read', 'crm:write', 'kb:read']);
  });

  it('adds commerce:read when a commerce connection is active', () => {
    const scopes = endUserScopesForConnectorDomains(['commerce']);
    expect(scopes).toContain('commerce:read');
    expect(scopes).not.toContain('bookings:read');
    expect(scopes).not.toContain('bookings:write');
  });

  it('adds bookings read and write when a bookings connection is active', () => {
    const scopes = endUserScopesForConnectorDomains(['bookings']);
    expect(scopes).toContain('bookings:read');
    expect(scopes).toContain('bookings:write');
    expect(scopes).not.toContain('commerce:read');
  });

  it('handles multiple and duplicate domains', () => {
    const scopes = endUserScopesForConnectorDomains(['commerce', 'bookings', 'commerce']);
    expect(scopes).toContain('commerce:read');
    expect(scopes).toContain('bookings:read');
    expect(scopes.filter((s) => s === 'commerce:read')).toHaveLength(1);
  });

  it('ignores unknown connector domains', () => {
    const scopes = endUserScopesForConnectorDomains(['invoices']);
    expect(scopes).toEqual(['conv:read', 'conv:write', 'crm:read', 'crm:write', 'kb:read']);
  });
});
