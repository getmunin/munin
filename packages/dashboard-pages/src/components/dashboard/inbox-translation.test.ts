import { describe, expect, it } from 'vitest';
import { makeDetail, makeMessage } from '../../test/inbox-fixtures';
import {
  languageLabel,
  sameLanguage,
  threadTranslations,
  untranslatedMessageIds,
} from './inbox-translation';

const thread = [
  makeMessage({ id: 'm1', body: 'Hola, ¿dónde está mi pedido?' }),
  makeMessage({ id: 'm2', authorType: 'agent', body: '¿Me das el número?' }),
  makeMessage({ id: 'm3', authorType: 'user', body: 'Intern merknad', internal: true }),
  makeMessage({ id: 'm4', authorType: 'system', body: 'Topic set.' }),
];

describe('untranslatedMessageIds', () => {
  it('lists public messages without a translation in the viewer language', () => {
    const detail = makeDetail('c', {
      messages: thread,
      translations: { customerLanguage: 'es', targetLanguage: 'nb', messages: { m1: 'Hei' } },
    });
    expect(untranslatedMessageIds(detail, 'nb')).toEqual(['m2']);
  });

  it('asks for everything while the customer language is still unknown', () => {
    expect(untranslatedMessageIds(makeDetail('c', { messages: thread }), 'nb')).toEqual([
      'm1',
      'm2',
    ]);
  });

  it('ignores translations made for another viewer language', () => {
    const detail = makeDetail('c', {
      messages: thread,
      translations: { customerLanguage: 'es', targetLanguage: 'en', messages: { m1: 'Hi' } },
    });
    expect(untranslatedMessageIds(detail, 'nb')).toEqual(['m1', 'm2']);
  });

  it('asks for nothing when the customer writes the viewer language', () => {
    const detail = makeDetail('c', { messages: thread, customerLanguage: 'no' });
    expect(untranslatedMessageIds(detail, 'nb')).toEqual([]);
  });
});

describe('threadTranslations', () => {
  it('returns the translations once the customer language differs from the viewer', () => {
    const detail = makeDetail('c', {
      messages: thread,
      customerLanguage: 'es',
      translations: { customerLanguage: 'es', targetLanguage: 'nb', messages: { m1: 'Hei' } },
    });
    expect(threadTranslations(detail, 'nb')).toEqual({ m1: 'Hei' });
  });

  it('offers no toggle when every stored translation equals the original', () => {
    const detail = makeDetail('c', {
      messages: [makeMessage({ id: 'm1', body: 'Hei' })],
      customerLanguage: 'es',
      translations: { customerLanguage: 'es', targetLanguage: 'nb', messages: { m1: 'Hei' } },
    });
    expect(threadTranslations(detail, 'nb')).toBeNull();
  });

  it('offers no toggle before the customer language is known', () => {
    const detail = makeDetail('c', {
      messages: thread,
      translations: { customerLanguage: null, targetLanguage: 'nb', messages: { m1: 'Hei' } },
    });
    expect(threadTranslations(detail, 'nb')).toBeNull();
  });
});

describe('language helpers', () => {
  it('matches regional variants and the Norwegian written standards', () => {
    expect(sameLanguage('pt-BR', 'pt')).toBe(true);
    expect(sameLanguage('nn', 'nb')).toBe(true);
    expect(sameLanguage('de', 'nb')).toBe(false);
  });

  it('names a language in the viewer locale and falls back to the tag', () => {
    expect(languageLabel('es', 'en')).toBe('Spanish');
    expect(languageLabel('es', 'nb')).toBe('spansk');
    expect(languageLabel('!!', 'en')).toBe('!!');
  });
});
