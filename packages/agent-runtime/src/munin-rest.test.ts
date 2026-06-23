import { describe, expect, it } from 'vitest';
import { createMuninRestClient, type ConversationDetail } from './munin-rest.ts';

function makeDetail(messages: ConversationDetail['messages']): ConversationDetail {
  return {
    id: 'conv_1',
    status: 'open',
    endUserId: 'eu_1',
    assigneeUserId: null,
    claim: null,
    messages,
  };
}

describe('toRuntimeHistory', () => {
  const client = createMuninRestClient({
    baseUrl: 'http://stub',
    adminApiKey: 'stub',
    fetch: () => Promise.reject(new Error('network not used in this test')),
  });

  it('remaps a human teammate (authorType "user") to the assistant-side staff role', () => {
    const history = client.toRuntimeHistory(
      makeDetail([
        { id: 'm1', authorType: 'end_user', body: 'can you source this wood?', createdAt: 't1' },
        { id: 'm2', authorType: 'agent', body: 'a teammate will follow up', createdAt: 't2' },
        { id: 'm3', authorType: 'user', body: 'what are you planning to make?', createdAt: 't3' },
        { id: 'm4', authorType: 'end_user', body: 'a rocking chair', createdAt: 't4' },
      ]),
    );

    expect(history.map((m) => m.authorType)).toEqual(['end_user', 'agent', 'staff', 'end_user']);
    const teammate = history[2];
    expect(teammate?.authorType).toBe('staff');
    expect(teammate?.body).toBe('what are you planning to make?');
  });

  it('drops internal messages', () => {
    const history = client.toRuntimeHistory(
      makeDetail([
        { id: 'm1', authorType: 'end_user', body: 'hi', createdAt: 't1' },
        { id: 'm2', authorType: 'agent', body: 'internal note', createdAt: 't2', internal: true },
      ]),
    );
    expect(history).toHaveLength(1);
    expect(history[0]?.authorType).toBe('end_user');
  });
});
