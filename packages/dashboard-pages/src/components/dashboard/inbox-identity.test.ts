import { describe, expect, it } from 'vitest';
import {
  PARTICIPANT_HUES,
  messageRole,
  participantColor,
  participantHues,
  participantKey,
} from './inbox-identity';
import type { MessageDto } from './inbox-types';

function msg(partial: Partial<MessageDto> & Pick<MessageDto, 'authorType' | 'authorId'>): MessageDto {
  return {
    id: partial.authorId + (partial.id ?? ''),
    conversationId: 'c1',
    authorName: null,
    body: 'x',
    internal: false,
    inReplyToId: null,
    attachments: [],
    metadata: {},
    createdAt: '2026-09-07T10:00:00Z',
    ...partial,
  };
}

describe('messageRole', () => {
  it('reads the viewer as self and every other staff member as other', () => {
    expect(messageRole(msg({ authorType: 'user', authorId: 'me' }), 'me')).toBe('self');
    expect(messageRole(msg({ authorType: 'user', authorId: 'colleague' }), 'me')).toBe('other');
  });

  it('keeps staff as self when the viewer is unknown rather than inverting them to counterparty', () => {
    expect(messageRole(msg({ authorType: 'user', authorId: 'me' }), null)).toBe('self');
    expect(messageRole(msg({ authorType: 'user', authorId: 'colleague' }), null)).toBe('self');
    expect(messageRole(msg({ authorType: 'end_user', authorId: 'u1' }), null)).toBe('other');
  });

  it('keeps the agent out of the human roles', () => {
    expect(messageRole(msg({ authorType: 'agent', authorId: 'a1' }), 'me')).toBe('agent');
    expect(messageRole(msg({ authorType: 'end_user', authorId: 'u1' }), 'me')).toBe('other');
    expect(messageRole(msg({ authorType: 'system', authorId: '' }), 'me')).toBe('system');
  });
});

describe('participantHues', () => {
  it('stays empty for a two-human thread so the counterparty keeps verdigris', () => {
    const thread = [
      msg({ authorType: 'end_user', authorId: 'u1' }),
      msg({ authorType: 'user', authorId: 'me' }),
      msg({ authorType: 'agent', authorId: 'a1' }),
    ];
    expect(participantHues(thread, 'me').size).toBe(0);
  });

  it('assigns hues in order to the non-self humans once a third human joins', () => {
    const thread = [
      msg({ authorType: 'end_user', authorId: 'u1' }),
      msg({ authorType: 'user', authorId: 'me' }),
      msg({ authorType: 'user', authorId: 'colleague' }),
    ];
    const hues = participantHues(thread, 'me');
    expect(hues.get(participantKey(msg({ authorType: 'end_user', authorId: 'u1' })))).toBe(165);
    expect(hues.get(participantKey(msg({ authorType: 'user', authorId: 'colleague' })))).toBe(32);
    expect(hues.has(participantKey(msg({ authorType: 'user', authorId: 'me' })))).toBe(false);
  });

  it('orders by first appearance, not by author type', () => {
    const thread = [
      msg({ authorType: 'user', authorId: 'colleague' }),
      msg({ authorType: 'user', authorId: 'me' }),
      msg({ authorType: 'end_user', authorId: 'u1' }),
    ];
    const hues = participantHues(thread, 'me');
    expect(hues.get('user:colleague')).toBe(165);
    expect(hues.get('end_user:u1')).toBe(32);
  });

  it('does not count the agent toward the three-human threshold', () => {
    const thread = [
      msg({ authorType: 'end_user', authorId: 'u1' }),
      msg({ authorType: 'agent', authorId: 'a1' }),
      msg({ authorType: 'agent', authorId: 'a2' }),
      msg({ authorType: 'user', authorId: 'me' }),
    ];
    expect(participantHues(thread, 'me').size).toBe(0);
  });

  it('counts the viewer even when they have not posted, so a colleague never collides with the customer', () => {
    const thread = [
      msg({ authorType: 'end_user', authorId: 'u1' }),
      msg({ authorType: 'user', authorId: 'colleague' }),
    ];
    const hues = participantHues(thread, 'me');
    expect(hues.get('end_user:u1')).toBe(165);
    expect(hues.get('user:colleague')).toBe(32);
  });

  it('assigns no hues when the viewer is unknown, since every staff member reads as self', () => {
    const thread = [
      msg({ authorType: 'end_user', authorId: 'u1' }),
      msg({ authorType: 'user', authorId: 'me' }),
      msg({ authorType: 'user', authorId: 'colleague' }),
    ];
    expect(participantHues(thread, null).size).toBe(0);
  });

  it('wraps around the ring rather than running out of hues', () => {
    const thread = Array.from({ length: PARTICIPANT_HUES.length + 1 }, (_, i) =>
      msg({ authorType: 'user', authorId: `u${i}` }),
    );
    const hues = participantHues(thread, 'me');
    expect(hues.get('user:u0')).toBe(PARTICIPANT_HUES[0]);
    expect(hues.get(`user:u${PARTICIPANT_HUES.length}`)).toBe(PARTICIPANT_HUES[0]);
  });
});

describe('participantColor', () => {
  it('varies hue only, holding lightness and chroma fixed', () => {
    expect(participantColor(165)).toBe('oklch(0.55 0.105 165)');
    expect(participantColor(315)).toBe('oklch(0.55 0.105 315)');
  });
});
