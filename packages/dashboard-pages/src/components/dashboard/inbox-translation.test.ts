import { describe, expect, it } from 'vitest';
import { makeDetail, makeDraft, makeMessage } from '../../test/inbox-fixtures';
import {
  draftAwaitsTranslation,
  draftInViewerLanguage,
  languageLabel,
  sameLanguage,
  subjectAwaitsTranslation,
  threadTranslations,
  translatedSubject,
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

describe('subject translation', () => {
  const titled = (overrides: Parameters<typeof makeDetail>[1] = {}) =>
    makeDetail('c', { messages: thread, subject: 'Pedido sin entregar', ...overrides });
  const translated = (subject: string | null, targetLanguage = 'nb') => ({
    customerLanguage: 'es',
    targetLanguage,
    messages: {},
    subject,
  });

  it('awaits a translation until one arrives for the viewer language', () => {
    expect(subjectAwaitsTranslation(titled(), 'nb')).toBe(true);
    expect(subjectAwaitsTranslation(titled({ translations: translated(null) }), 'nb')).toBe(true);
    expect(subjectAwaitsTranslation(titled({ translations: translated('Hei', 'en') }), 'nb')).toBe(
      true,
    );
    expect(
      subjectAwaitsTranslation(titled({ translations: translated('Ordre ikke levert') }), 'nb'),
    ).toBe(false);
  });

  it('awaits nothing without a subject or when the customer writes the viewer language', () => {
    expect(subjectAwaitsTranslation(titled({ subject: null }), 'nb')).toBe(false);
    expect(subjectAwaitsTranslation(titled({ customerLanguage: 'no' }), 'nb')).toBe(false);
  });

  it('shows the translation only when it differs from the original', () => {
    const spanish = { customerLanguage: 'es' };
    expect(
      translatedSubject(titled({ ...spanish, translations: translated('Ordre ikke levert') }), 'nb'),
    ).toBe('Ordre ikke levert');
    expect(
      translatedSubject(titled({ ...spanish, translations: translated('Pedido sin entregar') }), 'nb'),
    ).toBeNull();
    expect(
      translatedSubject(titled({ ...spanish, translations: translated('Order not delivered', 'en') }), 'nb'),
    ).toBeNull();
  });
});

describe('draft translation', () => {
  const spanishDraft = makeDraft('c', 'd1', 'Su pedido salió el martes.');
  const spanish = (translated?: string) =>
    makeDetail('c', {
      messages: [makeMessage({ id: 'm1', body: 'Hola' }), spanishDraft],
      customerLanguage: 'es',
      translations: {
        customerLanguage: 'es',
        targetLanguage: 'nb',
        messages: { m1: 'Hei', ...(translated ? { d1: translated } : {}) },
      },
    });

  it('asks for the pending draft when it is in the customer language and not yet translated', () => {
    expect(untranslatedMessageIds(spanish(), 'nb', spanishDraft)).toEqual(['d1']);
    expect(draftAwaitsTranslation(spanish(), spanishDraft, 'nb')).toBe(true);
  });

  it('shows the draft in the viewer language once its translation is in', () => {
    const detail = spanish('Bestillingen din ble sendt tirsdag.');
    expect(untranslatedMessageIds(detail, 'nb', spanishDraft)).toEqual([]);
    expect(draftInViewerLanguage(detail, spanishDraft, 'nb').body).toBe(
      'Bestillingen din ble sendt tirsdag.',
    );
  });

  it('leaves a draft asked for in the viewer language alone', () => {
    const norwegianDraft = makeDraft('c', 'd1', 'Bestillingen din ble sendt tirsdag.');
    norwegianDraft.metadata = { kind: 'draft_reply', language: 'nb' };
    expect(draftAwaitsTranslation(spanish(), norwegianDraft, 'nb')).toBe(false);
    expect(draftInViewerLanguage(spanish('Noe annet'), norwegianDraft, 'nb')).toBe(norwegianDraft);
  });

  it('does not hold a draft back while the customer language is unknown', () => {
    const detail = makeDetail('c', { messages: [spanishDraft] });
    expect(draftAwaitsTranslation(detail, spanishDraft, 'nb')).toBe(false);
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
