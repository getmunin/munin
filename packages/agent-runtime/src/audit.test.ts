import { describe, expect, it } from 'vitest';
import { auditReply } from './audit.js';
import { createStubProvider } from './providers/stub.js';

describe('auditReply', () => {
  it('returns handover=true when the model says deferral is implied', async () => {
    const stub = createStubProvider({
      responses: [
        {
          message: {
            role: 'assistant',
            content: '{"handover": true, "reason": "agent told the user a teammate would follow up"}',
          },
          finishReason: 'stop',
          usage: {},
        },
      ],
    });
    const verdict = await auditReply({
      provider: { baseUrl: 'http://stub', apiKey: 'k' },
      model: 'audit-model',
      question: 'When are you open Saturday?',
      reply: 'Let me flag this for a teammate who can answer.',
      toolNames: ['kb_search'],
      providerImpl: stub.provider,
    });
    expect(verdict.handover).toBe(true);
    expect(verdict.reason).toContain('teammate');
  });

  it('returns handover=false when the reply is a real answer', async () => {
    const stub = createStubProvider({
      responses: [
        {
          message: {
            role: 'assistant',
            content: '{"handover": false, "reason": "complete answer drawn from kb"}',
          },
          finishReason: 'stop',
          usage: {},
        },
      ],
    });
    const verdict = await auditReply({
      provider: { baseUrl: 'http://stub', apiKey: 'k' },
      model: 'audit-model',
      question: 'When are you open Saturday?',
      reply: 'We are open 10–16 on Saturdays.',
      toolNames: ['kb_search'],
      providerImpl: stub.provider,
    });
    expect(verdict.handover).toBe(false);
  });

  it('extracts JSON from prose that wraps it', async () => {
    const stub = createStubProvider({
      responses: [
        {
          message: {
            role: 'assistant',
            content:
              'Sure — here is my judgment:\n\n{"handover": true, "reason": "deferred to staff"}\n\nHope that helps.',
          },
          finishReason: 'stop',
          usage: {},
        },
      ],
    });
    const verdict = await auditReply({
      provider: { baseUrl: 'http://stub', apiKey: 'k' },
      model: 'audit-model',
      question: 'q',
      reply: 'r',
      toolNames: [],
      providerImpl: stub.provider,
    });
    expect(verdict.handover).toBe(true);
    expect(verdict.reason).toBe('deferred to staff');
  });

  it('fails open when the provider errors', async () => {
    const verdict = await auditReply({
      provider: { baseUrl: 'http://stub', apiKey: 'k' },
      model: 'audit-model',
      question: 'q',
      reply: 'r',
      toolNames: [],
      providerImpl: () => Promise.reject(new Error('upstream broken')),
    });
    expect(verdict).toEqual({ handover: false, reason: '' });
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
    const verdict = await auditReply({
      provider: { baseUrl: 'http://stub', apiKey: 'k' },
      model: 'audit-model',
      question: 'q',
      reply: 'r',
      toolNames: [],
      providerImpl: stub.provider,
    });
    expect(verdict).toEqual({ handover: false, reason: '' });
  });
});
