import { describe, expect, it } from 'vitest';
import {
  FALLBACK_GREET,
  FALLBACK_HANDOVER,
  FALLBACK_LOCALES,
  pickFallback,
} from './fallback-messages.ts';

describe('pickFallback', () => {
  it.each(FALLBACK_LOCALES)('resolves %s to itself', (code) => {
    expect(pickFallback(code)).toBe(code);
  });

  it('lowercases mixed-case input', () => {
    expect(pickFallback('NB')).toBe('nb');
    expect(pickFallback('Pt')).toBe('pt');
  });

  it('strips region suffix and matches base', () => {
    expect(pickFallback('en-US')).toBe('en');
    expect(pickFallback('nb-NO')).toBe('nb');
    expect(pickFallback('pt-BR')).toBe('pt');
    expect(pickFallback('zh-CN')).toBe('en');
  });

  it.each([null, undefined, '', 'xx', 'klingon', 'zh'])(
    'falls back to en for %s',
    (input) => {
      expect(pickFallback(input)).toBe('en');
    },
  );
});

describe('fallback string maps', () => {
  it('cover every supported locale for greet', () => {
    for (const code of FALLBACK_LOCALES) {
      expect(FALLBACK_GREET[code]).toMatch(/\S/);
    }
  });

  it('cover every supported locale for handover', () => {
    for (const code of FALLBACK_LOCALES) {
      expect(FALLBACK_HANDOVER[code]).toMatch(/\S/);
    }
  });
});
