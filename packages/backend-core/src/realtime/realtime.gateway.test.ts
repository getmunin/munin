import { describe, expect, it } from 'vitest';
import { readBearerSubprotocol } from './realtime.gateway.ts';

describe('readBearerSubprotocol', () => {
  it('returns null for undefined', () => {
    expect(readBearerSubprotocol(undefined)).toBeNull();
  });

  it('returns null when only one value is offered', () => {
    expect(readBearerSubprotocol('bearer')).toBeNull();
  });

  it('returns null when bearer marker is absent', () => {
    expect(readBearerSubprotocol('json, foo')).toBeNull();
  });

  it('parses the standard browser form', () => {
    expect(readBearerSubprotocol('bearer, mn_admin_abc')).toBe('mn_admin_abc');
  });

  it('is case-insensitive on the marker', () => {
    expect(readBearerSubprotocol('Bearer, mn_admin_abc')).toBe('mn_admin_abc');
  });

  it('honors the first bearer + token pair when more follow', () => {
    expect(readBearerSubprotocol('bearer, first, bearer, second')).toBe('first');
  });

  it('handles trailing commas and whitespace', () => {
    expect(readBearerSubprotocol('  bearer ,  mn_eu_xyz  , ')).toBe('mn_eu_xyz');
  });
});
