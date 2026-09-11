import { describe, expect, it } from 'vitest';
import { senderDisplayName } from './sender-name.ts';

describe('senderDisplayName', () => {
  it('keeps a real display name, trimmed', () => {
    expect(senderDisplayName('  Kari Nordmann ')).toBe('Kari Nordmann');
  });

  it('keeps a non-latin display name', () => {
    expect(senderDisplayName('Ås Øystein 3. etasje')).toBe('Ås Øystein 3. etasje');
  });

  it('drops a placeholder name with no letter or digit so callers fall back to the address', () => {
    expect(senderDisplayName('?')).toBeNull();
    expect(senderDisplayName('???')).toBeNull();
    expect(senderDisplayName(' - ')).toBeNull();
    expect(senderDisplayName('()')).toBeNull();
  });

  it('drops an empty or absent name', () => {
    expect(senderDisplayName('   ')).toBeNull();
    expect(senderDisplayName(null)).toBeNull();
    expect(senderDisplayName(undefined)).toBeNull();
  });
});
