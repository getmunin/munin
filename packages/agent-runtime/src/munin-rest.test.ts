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

describe('MuninRestError code extraction', () => {
  function clientRespondingWith(status: number, body: string) {
    return createMuninRestClient({
      baseUrl: 'http://munin.test',
      adminApiKey: 'mn_admin_test',
      fetch: () =>
        Promise.resolve(
          new Response(body, { status, headers: { 'content-type': 'application/json' } }),
        ),
    });
  }

  it('reads a structured code field from the error body', async () => {
    const client = clientRespondingWith(
      409,
      JSON.stringify({ message: 'handover_active: a human has taken over', code: 'handover_active' }),
    );
    await expect(client.getConversation('conv_1')).rejects.toMatchObject({
      name: 'MuninRestError',
      status: 409,
      code: 'handover_active',
    });
  });

  it('falls back to the message prefix when the body has no code field', async () => {
    const client = clientRespondingWith(
      409,
      JSON.stringify({ message: 'agent_reply_race: another reply was posted', statusCode: 409 }),
    );
    await expect(client.getConversation('conv_1')).rejects.toMatchObject({
      code: 'agent_reply_race',
    });
  });

  it('yields a null code for non-JSON bodies without a prefix', async () => {
    const client = clientRespondingWith(500, 'Internal server error');
    await expect(client.getConversation('conv_1')).rejects.toMatchObject({
      status: 500,
      code: null,
    });
  });
});
