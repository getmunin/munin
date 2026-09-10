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

  it('drops a voice turn that transcribed no speech, so no empty turn reaches the provider', () => {
    const history = client.toRuntimeHistory(
      makeDetail([
        { id: 'm1', authorType: 'end_user', body: 'my account is locked', createdAt: 't1' },
        { id: 'm2', authorType: 'end_user', body: '', createdAt: 't2' },
        { id: 'm3', authorType: 'agent', body: 'let me look', createdAt: 't3' },
      ]),
    );
    expect(history.map((m) => m.body)).toEqual(['my account is locked', 'let me look']);
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

describe('toRuntimeHistory attachments', () => {
  const client = createMuninRestClient({
    baseUrl: 'http://stub',
    adminApiKey: 'stub',
    fetch: () => Promise.reject(new Error('network not used in this test')),
  });

  it('keeps an image-only message, which the empty-body filter used to drop', () => {
    const history = client.toRuntimeHistory(
      makeDetail([
        {
          id: 'm1',
          authorType: 'end_user',
          body: '',
          createdAt: 't1',
          attachments: [
            { id: 'a1', mime: 'image/jpeg', name: 'photo.jpg', url: 'https://munin.test/v1/c/a/t' },
          ],
        },
      ]),
    );

    expect(history).toHaveLength(1);
    expect(history[0]?.body).toBe('');
    expect(history[0]?.attachments).toEqual([
      { mime: 'image/jpeg', url: 'https://munin.test/v1/c/a/t', name: 'photo.jpg' },
    ]);
  });

  it('still drops an internal message even when it carries an attachment', () => {
    const history = client.toRuntimeHistory(
      makeDetail([
        {
          id: 'm1',
          authorType: 'agent',
          body: '',
          createdAt: 't1',
          internal: true,
          attachments: [{ id: 'a1', mime: 'image/png', url: 'https://munin.test/v1/c/a/t' }],
        },
      ]),
    );

    expect(history).toEqual([]);
  });

  it('nulls the url of a tombstoned attachment so the loader placeholders it', () => {
    const history = client.toRuntimeHistory(
      makeDetail([
        {
          id: 'm1',
          authorType: 'end_user',
          body: 'here it is',
          createdAt: 't1',
          attachments: [
            { id: 'a1', mime: 'image/png', name: 'gone.png', url: null, deleted: true },
          ],
        },
      ]),
    );

    expect(history[0]?.attachments).toEqual([
      { mime: 'image/png', url: null, name: 'gone.png' },
    ]);
  });

  it('ignores projection rows that carry no usable mime', () => {
    const history = client.toRuntimeHistory(
      makeDetail([
        {
          id: 'm1',
          authorType: 'end_user',
          body: 'hello',
          createdAt: 't1',
          attachments: [{ id: 'a1' }, 'nonsense', null],
        },
      ]),
    );

    expect(history).toHaveLength(1);
    expect(history[0]?.attachments).toBeUndefined();
  });

  it('leaves an attachment-free message without an attachments field', () => {
    const history = client.toRuntimeHistory(
      makeDetail([{ id: 'm1', authorType: 'end_user', body: 'hello', createdAt: 't1' }]),
    );

    expect(history[0]?.attachments).toBeUndefined();
  });
});
