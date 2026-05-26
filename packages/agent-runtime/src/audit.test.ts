import { describe, expect, it } from 'vitest';
import { auditConversation } from './audit.ts';
import { createStubProvider } from './providers/stub.ts';

describe('auditConversation', () => {
  it('returns a request_handover action when the model says deferral is implied', async () => {
    const stub = createStubProvider({
      responses: [
        {
          message: {
            role: 'assistant',
            content: '{"actions":[{"type":"request_handover","reason":"agent told user a teammate would follow up"}]}',
          },
          finishReason: 'stop',
          usage: {},
        },
      ],
    });
    const verdict = await auditConversation({
      provider: { baseUrl: 'http://stub', apiKey: 'k' },
      model: 'audit',
      question: 'When are you open Saturday?',
      reply: 'Let me flag this for a teammate.',
      toolNames: ['kb_search'],
      providerImpl: stub.provider,
    });
    expect(verdict.actions).toEqual([
      { type: 'request_handover', reason: 'agent told user a teammate would follow up' },
    ]);
  });

  it('returns close_conversation for explicit goodbyes', async () => {
    const stub = createStubProvider({
      responses: [
        {
          message: {
            role: 'assistant',
            content: '{"actions":[{"type":"close_conversation","reason":"user said thanks that is all"}]}',
          },
          finishReason: 'stop',
          usage: {},
        },
      ],
    });
    const verdict = await auditConversation({
      provider: { baseUrl: 'http://stub', apiKey: 'k' },
      model: 'audit',
      question: "Thanks, that's all I needed!",
      reply: "Glad I could help.",
      toolNames: [],
      providerImpl: stub.provider,
    });
    expect(verdict.actions).toEqual([
      { type: 'close_conversation', reason: 'user said thanks that is all' },
    ]);
  });

  it('returns snooze_conversation with untilHours', async () => {
    const stub = createStubProvider({
      responses: [
        {
          message: {
            role: 'assistant',
            content: '{"actions":[{"type":"snooze_conversation","untilHours":24,"reason":"user will check tomorrow"}]}',
          },
          finishReason: 'stop',
          usage: {},
        },
      ],
    });
    const verdict = await auditConversation({
      provider: { baseUrl: 'http://stub', apiKey: 'k' },
      model: 'audit',
      question: "I'll check back tomorrow once I have the invoice number.",
      reply: 'Sure, take your time.',
      toolNames: [],
      providerImpl: stub.provider,
    });
    expect(verdict.actions).toEqual([
      { type: 'snooze_conversation', untilHours: 24, reason: 'user will check tomorrow' },
    ]);
  });

  it('drops snooze_conversation if untilHours is missing or non-positive', async () => {
    const stub = createStubProvider({
      responses: [
        {
          message: {
            role: 'assistant',
            content: '{"actions":[{"type":"snooze_conversation","reason":"forgot the hours"},{"type":"snooze_conversation","untilHours":-1,"reason":"bad"}]}',
          },
          finishReason: 'stop',
          usage: {},
        },
      ],
    });
    const verdict = await auditConversation({
      provider: { baseUrl: 'http://stub', apiKey: 'k' },
      model: 'audit',
      question: 'q',
      reply: 'r',
      toolNames: [],
      providerImpl: stub.provider,
    });
    expect(verdict.actions).toEqual([]);
  });

  it('returns mark_spam', async () => {
    const stub = createStubProvider({
      responses: [
        {
          message: {
            role: 'assistant',
            content: '{"actions":[{"type":"mark_spam","reason":"automated promotional message"}]}',
          },
          finishReason: 'stop',
          usage: {},
        },
      ],
    });
    const verdict = await auditConversation({
      provider: { baseUrl: 'http://stub', apiKey: 'k' },
      model: 'audit',
      question: 'BUY CRYPTO NOW visit example.example',
      reply: "I can't help with that.",
      toolNames: [],
      providerImpl: stub.provider,
    });
    expect(verdict.actions).toEqual([{ type: 'mark_spam', reason: 'automated promotional message' }]);
  });

  it('accepts set_topic when slug is in the catalog', async () => {
    const stub = createStubProvider({
      responses: [
        {
          message: {
            role: 'assistant',
            content: '{"actions":[{"type":"set_topic","topicSlug":"billing","reason":"question is about an invoice"}]}',
          },
          finishReason: 'stop',
          usage: {},
        },
      ],
    });
    const verdict = await auditConversation({
      provider: { baseUrl: 'http://stub', apiKey: 'k' },
      model: 'audit',
      question: 'I have a question about my invoice.',
      reply: '…',
      toolNames: [],
      topicCatalog: [
        { slug: 'billing', name: 'Billing' },
        { slug: 'support', name: 'Support' },
      ],
      providerImpl: stub.provider,
    });
    expect(verdict.actions).toEqual([
      { type: 'set_topic', topicSlug: 'billing', reason: 'question is about an invoice' },
    ]);
  });

  it('drops set_topic when slug is not in the catalog', async () => {
    const stub = createStubProvider({
      responses: [
        {
          message: {
            role: 'assistant',
            content: '{"actions":[{"type":"set_topic","topicSlug":"made-up-slug","reason":"hallucinated"}]}',
          },
          finishReason: 'stop',
          usage: {},
        },
      ],
    });
    const verdict = await auditConversation({
      provider: { baseUrl: 'http://stub', apiKey: 'k' },
      model: 'audit',
      question: 'q',
      reply: 'r',
      toolNames: [],
      topicCatalog: [{ slug: 'billing', name: 'Billing' }],
      providerImpl: stub.provider,
    });
    expect(verdict.actions).toEqual([]);
  });

  it('returns multiple actions in a single verdict', async () => {
    const stub = createStubProvider({
      responses: [
        {
          message: {
            role: 'assistant',
            content: '{"actions":[{"type":"set_topic","topicSlug":"billing","reason":"invoice question"},{"type":"close_conversation","reason":"user thanked us"}]}',
          },
          finishReason: 'stop',
          usage: {},
        },
      ],
    });
    const verdict = await auditConversation({
      provider: { baseUrl: 'http://stub', apiKey: 'k' },
      model: 'audit',
      question: 'q',
      reply: 'r',
      toolNames: [],
      topicCatalog: [{ slug: 'billing', name: 'Billing' }],
      providerImpl: stub.provider,
    });
    expect(verdict.actions).toHaveLength(2);
    expect(verdict.actions[0]?.type).toBe('set_topic');
    expect(verdict.actions[1]?.type).toBe('close_conversation');
  });

  it('extracts JSON from prose that wraps it', async () => {
    const stub = createStubProvider({
      responses: [
        {
          message: {
            role: 'assistant',
            content: 'Here is my judgment:\n\n{"actions":[{"type":"request_handover","reason":"deferred"}]}\n\nDone.',
          },
          finishReason: 'stop',
          usage: {},
        },
      ],
    });
    const verdict = await auditConversation({
      provider: { baseUrl: 'http://stub', apiKey: 'k' },
      model: 'audit',
      question: 'q',
      reply: 'r',
      toolNames: [],
      providerImpl: stub.provider,
    });
    expect(verdict.actions).toEqual([{ type: 'request_handover', reason: 'deferred' }]);
  });

  it('fails open when the provider errors', async () => {
    const verdict = await auditConversation({
      provider: { baseUrl: 'http://stub', apiKey: 'k' },
      model: 'audit',
      question: 'q',
      reply: 'r',
      toolNames: [],
      providerImpl: () => Promise.reject(new Error('upstream broken')),
    });
    expect(verdict).toEqual({ actions: [] });
  });

  it('fails open when the model returns unparseable text', async () => {
    const stub = createStubProvider({
      responses: [
        {
          message: { role: 'assistant', content: 'I cannot answer in JSON sorry' },
          finishReason: 'stop',
          usage: {},
        },
      ],
    });
    const verdict = await auditConversation({
      provider: { baseUrl: 'http://stub', apiKey: 'k' },
      model: 'audit',
      question: 'q',
      reply: 'r',
      toolNames: [],
      providerImpl: stub.provider,
    });
    expect(verdict).toEqual({ actions: [] });
  });
});
