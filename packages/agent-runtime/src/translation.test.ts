import { describe, expect, it } from 'vitest';
import { createStubProvider } from './providers/stub.ts';
import {
  batchMessages,
  createTranslationHandler,
  detectLanguage,
  parseTranslationResponse,
  rewriteInLanguage,
  translateMessages,
  translateText,
  type LanguageDetectionSample,
  type PendingTranslationMessage,
  type PendingTranslations,
  type SaveTranslationsInput,
  type TranslationRestClient,
} from './translation.ts';
import type { ProviderResponse } from './types.ts';

const PROVIDER = { baseUrl: 'http://stub', apiKey: 'k' };

const MESSAGES: PendingTranslationMessage[] = [
  { id: 'cvm_1', authorType: 'end_user', body: 'Hola, ¿dónde está mi pedido 40412?' },
  { id: 'cvm_2', authorType: 'agent', body: '¿Me das tu correo?' },
];

function reply(content: string): ProviderResponse {
  return { message: { role: 'assistant', content }, finishReason: 'stop', usage: {} };
}

describe('parseTranslationResponse', () => {
  it('maps the short prompt ids back to message ids', () => {
    const parsed = parseTranslationResponse(
      '{"language":"es","translations":[{"id":"m2","text":"Kan du gi meg e-posten din?"},{"id":"m1","text":"Hei, hvor er bestillingen min 40412?"}]}',
      MESSAGES,
    );
    expect(parsed).toEqual({
      customerLanguage: 'es',
      translations: [
        { messageId: 'cvm_2', body: 'Kan du gi meg e-posten din?' },
        { messageId: 'cvm_1', body: 'Hei, hvor er bestillingen min 40412?' },
      ],
    });
  });

  it('reads JSON wrapped in prose, including braces inside strings', () => {
    const parsed = parseTranslationResponse(
      'Here you go:\n```json\n{"language":"es","translations":[{"id":"m1","text":"Bruk {kode}"}]}\n```',
      MESSAGES,
    );
    expect(parsed?.translations).toEqual([{ messageId: 'cvm_1', body: 'Bruk {kode}' }]);
  });

  it('drops unknown ids, empty texts and a malformed language tag', () => {
    const parsed = parseTranslationResponse(
      '{"language":"Spanish","translations":[{"id":"m9","text":"x"},{"id":"m1","text":"  "}]}',
      MESSAGES,
    );
    expect(parsed).toEqual({ customerLanguage: null, translations: [] });
  });

  it('returns null for a reply that holds no JSON', () => {
    expect(parseTranslationResponse('Sorry, I cannot help with that.', MESSAGES)).toBeNull();
  });
});

describe('batchMessages', () => {
  it('splits on the character budget without splitting a message', () => {
    const long = (id: string): PendingTranslationMessage => ({
      id,
      authorType: 'end_user',
      body: 'x'.repeat(40),
    });
    const batches = batchMessages([long('a'), long('b'), long('c')], 90);
    expect(batches.map((b) => b.map((m) => m.id))).toEqual([['a', 'b'], ['c']]);
  });
});

describe('translateMessages', () => {
  it('fences each message as data and returns the translations', async () => {
    const stub = createStubProvider({
      responses: [
        reply(
          '{"language":"es","translations":[{"id":"m1","text":"Hei, hvor er bestillingen min 40412?"},{"id":"m2","text":"Kan du gi meg e-posten din?"}]}',
        ),
      ],
    });
    const result = await translateMessages({
      provider: PROVIDER,
      model: 'fast',
      targetLanguage: 'nb',
      customerLanguage: null,
      messages: MESSAGES,
      providerImpl: stub.provider,
    });
    expect(result.customerLanguage).toBe('es');
    expect(result.translations).toHaveLength(2);
    const prompt = stub.calls[0]!.messages.map((m) => m.content).join('\n');
    expect(prompt).toContain('<data id="m1" from="customer">');
    expect(prompt).toContain('Norwegian Bokmål (nb)');
  });

  it('stores nothing when the customer already writes the target language', async () => {
    const stub = createStubProvider({
      responses: [reply('{"language":"no","translations":[{"id":"m1","text":"Hei"}]}')],
    });
    const result = await translateMessages({
      provider: PROVIDER,
      model: 'fast',
      targetLanguage: 'nb',
      customerLanguage: null,
      messages: MESSAGES,
      providerImpl: stub.provider,
    });
    expect(result).toEqual({ customerLanguage: 'no', translations: [] });
  });
});

describe('translateText', () => {
  it('fences the reply as data and returns the translation trimmed', async () => {
    const stub = createStubProvider({ responses: [reply('  Le reembolsamos hoy.\n')] });
    const text = await translateText({
      provider: PROVIDER,
      model: 'fast',
      text: 'Vi refunderer deg i dag.',
      sourceLanguage: 'nb',
      targetLanguage: 'es',
      providerImpl: stub.provider,
    });
    expect(text).toBe('Le reembolsamos hoy.');
    const [system, user] = stub.calls[0]!.messages;
    expect(system!.content).toContain('from Norwegian Bokmål (nb) into Spanish (es)');
    expect(user!.content).toBe('<data>\nVi refunderer deg i dag.\n</data>');
  });
});

describe('rewriteInLanguage', () => {
  const args = {
    provider: PROVIDER,
    model: 'fast',
    text: 'Dzień dobry, wyślemy fakturę dzisiaj.',
    targetLanguage: 'nb',
  };

  it('keeps the draft as written when the model says it is already in the language', async () => {
    const stub = createStubProvider({ responses: [reply('"OK."')] });
    expect(await rewriteInLanguage({ ...args, text: 'Hei!', providerImpl: stub.provider })).toBe(
      'Hei!',
    );
    expect(stub.calls[0]!.messages[0]!.content).toContain('answer with exactly OK');
  });

  it('returns the rewritten draft when the model translates it', async () => {
    const stub = createStubProvider({ responses: [reply(' Hei, vi sender fakturaen i dag.\n')] });
    expect(await rewriteInLanguage({ ...args, providerImpl: stub.provider })).toBe(
      'Hei, vi sender fakturaen i dag.',
    );
    expect(stub.calls[0]!.messages[1]!.content).toBe(
      '<data>\nDzień dobry, wyślemy fakturę dzisiaj.\n</data>',
    );
  });
});

function fakeRest(
  pending: PendingTranslations,
  sample: LanguageDetectionSample = {
    conversationId: pending.conversationId,
    customerLanguage: pending.customerLanguage,
    messages: pending.messages.filter((m) => m.authorType === 'end_user'),
  },
) {
  const saved: Array<{ conversationId: string; input: SaveTranslationsInput }> = [];
  const languages: Array<{ conversationId: string; customerLanguage: string }> = [];
  let pendingCalls = 0;
  const rest: TranslationRestClient = {
    getPendingTranslations() {
      pendingCalls += 1;
      return Promise.resolve(pending);
    },
    saveTranslations(conversationId, input) {
      saved.push({ conversationId, input });
      return Promise.resolve({ saved: input.translations.length });
    },
    getLanguageDetectionSample() {
      return Promise.resolve(sample);
    },
    saveCustomerLanguage(conversationId, customerLanguage) {
      languages.push({ conversationId, customerLanguage });
      return Promise.resolve({ saved: true, customerLanguage });
    },
  };
  return { rest, saved, languages, pendingCalls: () => pendingCalls };
}

describe('createTranslationHandler', () => {
  const pending: PendingTranslations = {
    conversationId: 'ccv_1',
    customerLanguage: null,
    targetLanguage: 'nb',
    messages: MESSAGES,
  };

  it('translates the pending messages and saves them with the detected language', async () => {
    const { rest, saved } = fakeRest(pending);
    const stub = createStubProvider({
      responses: [reply('{"language":"es","translations":[{"id":"m1","text":"Hei"}]}')],
    });
    const handler = createTranslationHandler({
      rest,
      provider: PROVIDER,
      model: 'fast',
      providerImpl: stub.provider,
    });
    handler.request({ conversationId: 'ccv_1', targetLanguage: 'nb' });
    await handler.idle();
    expect(saved).toEqual([
      {
        conversationId: 'ccv_1',
        input: {
          targetLanguage: 'nb',
          customerLanguage: 'es',
          translations: [{ messageId: 'cvm_1', body: 'Hei' }],
        },
      },
    ]);
  });

  it('runs once more, not once per request, when asked again mid-flight', async () => {
    const { rest, pendingCalls } = fakeRest(pending);
    const stub = createStubProvider({
      responses: [
        reply('{"language":"es","translations":[]}'),
        reply('{"language":"es","translations":[]}'),
      ],
    });
    const handler = createTranslationHandler({
      rest,
      provider: PROVIDER,
      model: 'fast',
      providerImpl: stub.provider,
    });
    const trigger = { conversationId: 'ccv_1', targetLanguage: 'nb' };
    handler.request(trigger);
    handler.request(trigger);
    handler.request(trigger);
    await handler.idle();
    expect(pendingCalls()).toBe(2);
    expect(stub.calls).toHaveLength(2);
  });

  it('skips the model call when the generate gate says no', async () => {
    const { rest, saved } = fakeRest(pending);
    const stub = createStubProvider({ responses: [] });
    const handler = createTranslationHandler({
      rest,
      provider: PROVIDER,
      model: 'fast',
      providerImpl: stub.provider,
      beforeGenerate: () => Promise.resolve({ allowed: false, reason: 'quota' }),
    });
    handler.request({ conversationId: 'ccv_1', targetLanguage: 'nb' });
    await handler.idle();
    expect(stub.calls).toHaveLength(0);
    expect(saved).toHaveLength(0);
  });
});

describe('detectLanguage', () => {
  it('reads the language tag from the model answer', async () => {
    const stub = createStubProvider({ responses: [reply('{"language":"ES"}')] });
    expect(
      await detectLanguage({
        provider: PROVIDER,
        model: 'fast',
        messages: MESSAGES,
        providerImpl: stub.provider,
      }),
    ).toBe('es');
    expect(stub.calls[0]!.messages[1]!.content).toContain('Hola, ¿dónde está mi pedido 40412?');
  });

  it('gives null without calling the model when there is nothing to read', async () => {
    const stub = createStubProvider({ responses: [] });
    expect(
      await detectLanguage({ provider: PROVIDER, model: 'fast', messages: [], providerImpl: stub.provider }),
    ).toBeNull();
    expect(stub.calls).toHaveLength(0);
  });

  it('gives null when the answer holds no language tag', async () => {
    const stub = createStubProvider({ responses: [reply('Spanish, I think')] });
    expect(
      await detectLanguage({
        provider: PROVIDER,
        model: 'fast',
        messages: MESSAGES,
        providerImpl: stub.provider,
      }),
    ).toBeNull();
  });
});

describe('createTranslationHandler detect', () => {
  const pending: PendingTranslations = {
    conversationId: 'ccv_1',
    customerLanguage: null,
    targetLanguage: 'nb',
    messages: MESSAGES,
  };

  it('stores the language the customer writes in', async () => {
    const { rest, languages, saved } = fakeRest(pending);
    const stub = createStubProvider({ responses: [reply('{"language":"es"}')] });
    const handler = createTranslationHandler({
      rest,
      provider: PROVIDER,
      model: 'fast',
      providerImpl: stub.provider,
    });
    handler.detect('ccv_1');
    await handler.idle();
    expect(languages).toEqual([{ conversationId: 'ccv_1', customerLanguage: 'es' }]);
    expect(saved).toHaveLength(0);
  });

  it('skips the model call once the language is known', async () => {
    const { rest, languages } = fakeRest(pending, {
      conversationId: 'ccv_1',
      customerLanguage: 'es',
      messages: [],
    });
    const stub = createStubProvider({ responses: [] });
    const handler = createTranslationHandler({
      rest,
      provider: PROVIDER,
      model: 'fast',
      providerImpl: stub.provider,
    });
    handler.detect('ccv_1');
    await handler.idle();
    expect(stub.calls).toHaveLength(0);
    expect(languages).toHaveLength(0);
  });

  it('skips the model call when the generate gate says no', async () => {
    const { rest, languages } = fakeRest(pending);
    const stub = createStubProvider({ responses: [] });
    const handler = createTranslationHandler({
      rest,
      provider: PROVIDER,
      model: 'fast',
      providerImpl: stub.provider,
      beforeGenerate: () => Promise.resolve({ allowed: false, reason: 'quota' }),
    });
    handler.detect('ccv_1');
    await handler.idle();
    expect(stub.calls).toHaveLength(0);
    expect(languages).toHaveLength(0);
  });

  it('stores nothing when the model gives no language tag', async () => {
    const { rest, languages } = fakeRest(pending);
    const stub = createStubProvider({ responses: [reply('not sure')] });
    const handler = createTranslationHandler({
      rest,
      provider: PROVIDER,
      model: 'fast',
      providerImpl: stub.provider,
    });
    handler.detect('ccv_1');
    await handler.idle();
    expect(languages).toHaveLength(0);
  });
});
