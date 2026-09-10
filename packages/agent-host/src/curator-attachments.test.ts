import { describe, expect, it } from 'vitest';
import { conversationIdOf } from './runner.service.ts';

describe('conversationIdOf', () => {
  it('reads the conversation a conv-scoped curator job was queued for', () => {
    expect(
      conversationIdOf({ sourceEventPayload: { conversationId: 'ccv_1', channelType: 'chat' } }),
    ).toBe('ccv_1');
  });

  it('returns null for a scheduled sweep that names no conversation', () => {
    expect(conversationIdOf({ sourceEventPayload: { scope: 'org' } })).toBeNull();
    expect(conversationIdOf({ sourceEventPayload: null })).toBeNull();
    expect(conversationIdOf({ sourceEventPayload: undefined })).toBeNull();
  });

  it('ignores a non-string conversationId rather than coercing it', () => {
    expect(conversationIdOf({ sourceEventPayload: { conversationId: 42 } })).toBeNull();
    expect(conversationIdOf({ sourceEventPayload: { conversationId: '' } })).toBeNull();
  });
});
