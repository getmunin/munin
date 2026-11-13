import { describe, expect, it } from 'vitest';
import { formatLanguageContext } from './vapi-assistant.ts';

describe('formatLanguageContext', () => {
  it('names the widget locale so the voice agent greets in it', () => {
    const out = formatLanguageContext('sv');
    expect(out).toContain('[Language]');
    expect(out).toContain('Swedish (sv)');
  });

  it('accepts region-tagged locales', () => {
    expect(formatLanguageContext('nb-NO')).toContain('Norwegian Bokmål');
  });

  it('returns nothing for missing, blank, malformed or unknown locales', () => {
    expect(formatLanguageContext(undefined)).toBeUndefined();
    expect(formatLanguageContext(42)).toBeUndefined();
    expect(formatLanguageContext('  ')).toBeUndefined();
    expect(formatLanguageContext('not a locale!')).toBeUndefined();
    expect(formatLanguageContext('xx')).toBeUndefined();
  });
});
