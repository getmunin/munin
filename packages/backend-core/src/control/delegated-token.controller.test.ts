import { describe, expect, it } from 'vitest';
import { MintSchema } from './delegated-token.controller.ts';

describe('Delegated token MintSchema', () => {
  it('accepts a self_service mint with a known scope', () => {
    const r = MintSchema.safeParse({
      externalId: 'u_123',
      audiences: ['self_service'],
      scopes: ['crm:read'],
    });
    expect(r.success).toBe(true);
  });

  it('defaults audiences to [self_service] when omitted', () => {
    const r = MintSchema.safeParse({ externalId: 'u_123' });
    expect(r.success).toBe(true);
    expect(r.success && r.data.audiences).toEqual(['self_service']);
  });

  it('rejects audience=admin', () => {
    const r = MintSchema.safeParse({
      externalId: 'u_123',
      audiences: ['admin'],
    });
    expect(r.success).toBe(false);
  });

  it('rejects wildcard scope *', () => {
    const r = MintSchema.safeParse({
      externalId: 'u_123',
      scopes: ['*'],
    });
    expect(r.success).toBe(false);
  });

  it('rejects an admin-only scope like kb:write', () => {
    const r = MintSchema.safeParse({
      externalId: 'u_123',
      scopes: ['kb:write'],
    });
    expect(r.success).toBe(false);
  });

  it('requires at least one of endUserId/externalId/email/phone', () => {
    const r = MintSchema.safeParse({});
    expect(r.success).toBe(false);
  });
});
