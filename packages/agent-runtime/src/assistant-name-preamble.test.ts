import { describe, expect, it } from 'vitest';
import { assistantNamePreamble } from './conversation-handler.js';

describe('assistantNamePreamble', () => {
  it('emits a one-line preamble when a name is set', () => {
    expect(assistantNamePreamble('Munin')).toBe('Your name is Munin.\n\n');
  });

  it('returns empty string when name is null', () => {
    expect(assistantNamePreamble(null)).toBe('');
  });

  it('returns empty string when name is undefined', () => {
    expect(assistantNamePreamble(undefined)).toBe('');
  });

  it('returns empty string for whitespace-only name', () => {
    expect(assistantNamePreamble('   ')).toBe('');
  });

  it('trims surrounding whitespace', () => {
    expect(assistantNamePreamble('  Munin  ')).toBe('Your name is Munin.\n\n');
  });
});
