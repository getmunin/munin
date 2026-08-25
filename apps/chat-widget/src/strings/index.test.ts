import { afterEach, describe, expect, it } from 'vitest';
import { format, pickLocale, DEFAULT_LOCALE, type PluralValue } from './index.ts';

describe('pickLocale', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis.navigator, 'language');
  const originalLanguages = Object.getOwnPropertyDescriptor(globalThis.navigator, 'languages');

  afterEach(() => {
    if (original) Object.defineProperty(globalThis.navigator, 'language', original);
    if (originalLanguages) Object.defineProperty(globalThis.navigator, 'languages', originalLanguages);
  });

  function setBrowserLanguage(primary: string, list: string[] = [primary]): void {
    Object.defineProperty(globalThis.navigator, 'language', {
      value: primary,
      configurable: true,
    });
    Object.defineProperty(globalThis.navigator, 'languages', { value: list, configurable: true });
  }

  it('prefers the explicit prefer arg when supported', () => {
    setBrowserLanguage('en-US');
    expect(pickLocale('nb').locale).toBe('nb');
  });

  it('falls back to navigator.language', () => {
    setBrowserLanguage('de-AT', ['de-AT', 'en-US']);
    expect(pickLocale(null).locale).toBe('de');
  });

  it('walks navigator.languages when the primary is unsupported', () => {
    setBrowserLanguage('xx-YY', ['xx-YY', 'fr-FR']);
    expect(pickLocale(undefined).locale).toBe('fr');
  });

  it('falls back to default locale when nothing matches', () => {
    setBrowserLanguage('xx-YY', ['xx', 'zz']);
    expect(pickLocale(null).locale).toBe(DEFAULT_LOCALE);
  });

  it('ignores empty / whitespace-only prefer', () => {
    setBrowserLanguage('sv-SE');
    expect(pickLocale('').locale).toBe('sv');
  });

  it('lowercases and strips region from a tag', () => {
    setBrowserLanguage('en');
    expect(pickLocale('PT-BR').locale).toBe('pt');
  });

  it('serves Nynorsk its own strings rather than folding it into Bokmål', () => {
    setBrowserLanguage('en');
    expect(pickLocale('nn').locale).toBe('nn');
    expect(pickLocale('nn-NO').locale).toBe('nn');
    expect(pickLocale('nno').locale).toBe('nn');
    expect(pickLocale('nn').strings.timeNow).toBe('no');
  });

  it('keeps the unmarked Norwegian tags on Bokmål', () => {
    setBrowserLanguage('en');
    expect(pickLocale('no').locale).toBe('nb');
    expect(pickLocale('nb-NO').locale).toBe('nb');
    expect(pickLocale('nor').locale).toBe('nb');
  });

  it('resolves each newly added Baltic and Central European locale', () => {
    setBrowserLanguage('en');
    for (const tag of ['et', 'lv', 'lt', 'cs', 'sk', 'hu', 'ro']) {
      expect(pickLocale(tag).locale).toBe(tag);
    }
  });
});

describe('format', () => {
  it('returns plain strings unchanged when no params given', () => {
    expect(format('Hello world', 'en')).toBe('Hello world');
  });

  it('substitutes named placeholders', () => {
    expect(format('Hi {name}, you have {n} messages', 'en', { name: 'Ada', n: 3 })).toBe(
      'Hi Ada, you have 3 messages',
    );
  });

  it('selects one vs other for English plurals', () => {
    const v: PluralValue = { one: '1 message', other: '{count} messages' };
    expect(format(v, 'en', { count: 1 })).toBe('1 message');
    expect(format(v, 'en', { count: 5 })).toBe('5 messages');
    expect(format(v, 'en', { count: 0 })).toBe('0 messages');
  });

  it('selects few/many for Polish plurals', () => {
    const v: PluralValue = {
      one: '{count} wiadomość',
      few: '{count} wiadomości',
      many: '{count} wiadomości',
      other: '{count} wiadomości',
    };
    expect(format(v, 'pl', { count: 1 })).toBe('1 wiadomość');
    expect(format(v, 'pl', { count: 2 })).toBe('2 wiadomości');
    expect(format(v, 'pl', { count: 5 })).toBe('5 wiadomości');
  });

  it('falls back to other when the chosen plural category is absent', () => {
    const v: PluralValue = { one: 'just one', other: 'many ({count})' };
    expect(format(v, 'en', { count: 7 })).toBe('many (7)');
  });

  it('leaves unknown placeholders empty', () => {
    expect(format('Hello {nope}', 'en')).toBe('Hello ');
  });
});
