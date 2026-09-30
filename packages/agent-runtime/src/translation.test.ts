import { describe, expect, it } from 'vitest';
import { createStubProvider } from './providers/stub.ts';
import {
  batchMessages,
  contextWindow,
  createTranslationHandler,
  parseTranslationResponse,
  rewriteInLanguage,
  translateMessages,
  translateText,
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

  it('shows earlier messages as context without ids, so a short follow-up keeps its meaning', async () => {
    const stub = createStubProvider({
      responses: [reply('{"language":"es","translations":[{"id":"m1","text":"Ja, den blå"}]}')],
    });
    const result = await translateMessages({
      provider: PROVIDER,
      model: 'fast',
      targetLanguage: 'nb',
      customerLanguage: 'es',
      context: [{ id: 'cvm_0', authorType: 'agent', body: '¿Quiere la chaqueta azul o la roja?' }],
      messages: [{ id: 'cvm_9', authorType: 'end_user', body: 'Sí, la azul' }],
      providerImpl: stub.provider,
    });
    expect(result.translations).toEqual([{ messageId: 'cvm_9', body: 'Ja, den blå' }]);
    const prompt = stub.calls[0]!.messages[1]!.content!;
    expect(prompt).toContain('<data from="assistant">\n¿Quiere la chaqueta azul o la roja?\n</data>');
    expect(prompt.indexOf('[Earlier messages')).toBeLessThan(prompt.indexOf('[Messages, oldest first]'));
    expect(prompt).toContain('<data id="m1" from="customer">');
  });

  it('carries the end of one batch into the next as context', async () => {
    const long = (n: number): PendingTranslationMessage => ({
      id: `cvm_${n}`,
      authorType: 'end_user',
      body: `${'x'.repeat(3500)} ${n}`,
    });
    const stub = createStubProvider({
      responses: [
        reply('{"language":"es","translations":[]}'),
        reply('{"language":"es","translations":[]}'),
      ],
    });
    await translateMessages({
      provider: PROVIDER,
      model: 'fast',
      targetLanguage: 'nb',
      customerLanguage: null,
      messages: [long(1), long(2)],
      providerImpl: stub.provider,
    });
    expect(stub.calls).toHaveLength(2);
    expect(stub.calls[0]!.messages[1]!.content).not.toContain('[Earlier messages');
    const second = stub.calls[1]!.messages[1]!.content!;
    expect(second).toContain('[Earlier messages');
    expect(second).toContain('x 1\n</data>');
    expect(second).toContain('<data id="m1" from="customer">');
  });
});

describe('contextWindow', () => {
  const msg = (id: string, body: string): PendingTranslationMessage => ({
    id,
    authorType: 'end_user',
    body,
  });

  it('keeps the most recent messages, oldest first', () => {
    const messages = ['a', 'b', 'c', 'd'].map((b, i) => msg(`cvm_${i}`, b));
    expect(contextWindow(messages, 2).map((m) => m.body)).toEqual(['c', 'd']);
  });

  it('stops before the character budget runs out', () => {
    const messages = [msg('cvm_1', 'x'.repeat(10)), msg('cvm_2', 'y'.repeat(10))];
    expect(contextWindow(messages, 6, 15).map((m) => m.id)).toEqual(['cvm_2']);
  });

  it('keeps the end of a single message longer than the budget', () => {
    expect(contextWindow([msg('cvm_1', 'abcdef')], 6, 3)).toEqual([msg('cvm_1', 'def')]);
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

function fakeRest(pending: PendingTranslations) {
  const saved: Array<{ conversationId: string; input: SaveTranslationsInput }> = [];
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
  };
  return { rest, saved, pendingCalls: () => pendingCalls };
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
