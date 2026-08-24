import { describe, expect, it } from 'vitest';
import { audienceForDomain, type ConnectorDomain } from './connector.ts';

describe('audienceForDomain', () => {
  it('marks commerce and bookings as reachable by customers and the team', () => {
    expect(audienceForDomain('commerce')).toBe('both');
    expect(audienceForDomain('bookings')).toBe('both');
  });

  it('marks seo as team-only because it ships no self-service tools', () => {
    expect(audienceForDomain('seo')).toBe('team');
  });

  it('marks custom mcp as customer-only because its tools are proxied into end-user sessions', () => {
    expect(audienceForDomain('mcp')).toBe('customer');
  });

  it('covers every connector domain', () => {
    const domains: ConnectorDomain[] = ['commerce', 'bookings', 'mcp', 'seo'];
    for (const domain of domains) {
      expect(['customer', 'team', 'both']).toContain(audienceForDomain(domain));
    }
  });
});
