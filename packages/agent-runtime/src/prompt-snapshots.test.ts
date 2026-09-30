import { describe, expect, it } from 'vitest';
import { auditConversation } from './audit.ts';
import { greetSeedBody } from './conversation-handler.ts';
import { createStubProvider, type StubProviderHandle } from './providers/stub.ts';
import { runAgent } from './runtime.ts';
import {
  detectLanguage,
  rewriteInLanguage,
  translateMessages,
  translateText,
} from './translation.ts';
import type { ProviderResponse } from './types.ts';

const PROVIDER = { baseUrl: 'http://stub', apiKey: 'k' };

function stub(content: string): StubProviderHandle {
  const response: ProviderResponse = {
    message: { role: 'assistant', content },
    finishReason: 'stop',
    usage: {},
  };
  return createStubProvider({ responses: [response] });
}

async function expectPrompts(handle: StubProviderHandle, name: string): Promise<void> {
  const messages = handle.calls[0]!.messages;
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content);
  const user = messages.filter((m) => m.role === 'user').map((m) => m.content);
  await expect(`${system.join('\n\n')}\n`).toMatchFileSnapshot(`./__prompts__/${name}.system.txt`);
  await expect(`${user.join('\n\n')}\n`).toMatchFileSnapshot(`./__prompts__/${name}.user.txt`);
}

describe('internal prompts, exactly as sent to the model', () => {
  it('translateMessages', async () => {
    const handle = stub('{"language":"es","translations":[]}');
    await translateMessages({
      provider: PROVIDER,
      model: 'm',
      targetLanguage: 'nb',
      customerLanguage: 'es',
      context: [
        { id: 'cvm_1', authorType: 'end_user', body: '¿Tienen la chaqueta en azul?' },
        { id: 'cvm_2', authorType: 'agent', body: 'Sí, en las tallas S y M.' },
      ],
      messages: [
        { id: 'cvm_3', authorType: 'end_user', body: 'La M, por favor.' },
        { id: 'cvm_4', authorType: 'user', body: 'Te la reservo hasta el viernes.' },
      ],
      providerImpl: handle.provider,
    });
    await expectPrompts(handle, 'translate-messages');
  });

  it('detectLanguage', async () => {
    const handle = stub('{"language":"es"}');
    await detectLanguage({
      provider: PROVIDER,
      model: 'm',
      messages: [
        { id: 'cvm_1', authorType: 'end_user', body: '¿Tienen la chaqueta en azul?' },
        { id: 'cvm_3', authorType: 'end_user', body: 'La M, por favor.' },
      ],
      providerImpl: handle.provider,
    });
    await expectPrompts(handle, 'detect-language');
  });

  it('rewriteInLanguage', async () => {
    const handle = stub('OK');
    await rewriteInLanguage({
      provider: PROVIDER,
      model: 'm',
      targetLanguage: 'nb',
      text: 'Draft for teammate:\nHei {{FIRST_NAME}}, jakken er [[reservert]] til fredag.',
      providerImpl: handle.provider,
    });
    await expectPrompts(handle, 'rewrite-in-language');
  });

  it('translateText', async () => {
    const handle = stub('Te la reservo hasta el viernes.');
    await translateText({
      provider: PROVIDER,
      model: 'm',
      sourceLanguage: 'nb',
      targetLanguage: 'es',
      text: 'Jeg holder den av til fredag.',
      providerImpl: handle.provider,
    });
    await expectPrompts(handle, 'translate-text');
  });

  it('auditConversation with a subject, a thread, a draft language and topics', async () => {
    const handle = stub('{"rationale":"","actions":[]}');
    await auditConversation({
      provider: PROVIDER,
      model: 'm',
      subject: 'Jacket reservation',
      thread: [
        { authorType: 'end_user', body: 'Do you have the jacket in blue?' },
        { authorType: 'agent', body: 'Yes, in sizes S and M.' },
      ],
      question: 'M please, can you hold it?',
      reply: 'Jeg holder av jakken i M til fredag.',
      draftLanguage: 'nb',
      toolNames: ['kb_search', 'commerce_get_product'],
      topicCatalog: [
        { slug: 'orders', name: 'Orders', description: 'Order status and changes' },
        { slug: 'returns', name: 'Returns' },
      ],
      providerImpl: handle.provider,
    });
    await expectPrompts(handle, 'audit');
  });

  it('auditConversation with nothing but the turn', async () => {
    const handle = stub('{"rationale":"","actions":[]}');
    await auditConversation({
      provider: PROVIDER,
      model: 'm',
      question: 'When do you open on Saturday?',
      reply: 'We open at 10 on Saturdays.',
      toolNames: [],
      providerImpl: handle.provider,
    });
    await expectPrompts(handle, 'audit-minimal');
  });

  it('runAgent with quoted history and messages left out of the context window', async () => {
    const handle = stub('We open at 10.');
    await runAgent({
      config: {
        provider: PROVIDER,
        model: 'm',
        systemPrompt: '<the org system prompt>',
        volatileSystemPrompt: '<the per-turn context>',
        maxHistoryChars: 1000,
      },
      history: [
        { authorType: 'end_user', body: 'x'.repeat(2000), createdAt: '2026-01-01T00:00:00.000Z' },
        {
          authorType: 'end_user',
          body: 'Is this still true?',
          createdAt: '2026-01-02T00:00:00.000Z',
          quotedHistory: [
            { from: 'Acme', date: '1 January', subject: 'Opening hours', body: 'We open at 10.' },
          ],
        },
      ],
      mcp: { listTools: () => Promise.resolve([]), callTool: () => Promise.reject(new Error('no tools')) },
      provider: handle.provider,
    });
    await expectPrompts(handle, 'agent-turn');
  });

  it('greetSeedBody', async () => {
    await expect(`${greetSeedBody('nb')}\n\n${greetSeedBody(null)}\n`).toMatchFileSnapshot(
      './__prompts__/greet.user.txt',
    );
  });
});
