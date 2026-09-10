import { describe, expect, it } from 'vitest';
import { deliveryFailure, startsAuthorGroup, suppressedKind } from './inbox-message-bubble';
import type { MessageDto } from './inbox-types';

const message = (overrides: Partial<MessageDto> = {}): MessageDto => ({
  id: 'cvm_1',
  conversationId: 'ccv_1',
  authorType: 'end_user',
  authorId: 'cvc_1',
  authorName: 'Terje Bang',
  body: 'x',
  internal: false,
  inReplyToId: null,
  attachments: [],
  metadata: {},
  createdAt: '2026-09-09T10:30:00.000Z',
  ...overrides,
});

describe('suppressedKind', () => {
  it('reads the ingest stamp and ignores a non-string value', () => {
    expect(suppressedKind(message({ metadata: { suppressed: 'auto_reply' } }))).toBe('auto_reply');
    expect(suppressedKind(message({ metadata: { suppressed: true } }))).toBeNull();
    expect(suppressedKind(message())).toBeNull();
  });
});

describe('startsAuthorGroup', () => {
  it('breaks the group so an auto-reply always carries its own marker', () => {
    const human = message({ id: 'cvm_1' });
    const auto = message({ id: 'cvm_2', metadata: { suppressed: 'auto_reply' } });
    expect(startsAuthorGroup(auto, human)).toBe(true);
    expect(startsAuthorGroup(human, auto)).toBe(true);
  });

  it('still groups consecutive messages from the same sender', () => {
    expect(startsAuthorGroup(message({ id: 'cvm_2' }), message())).toBe(false);
  });
});

describe('deliveryFailure', () => {
  const outgoing = (overrides: Partial<MessageDto> = {}) =>
    message({ authorType: 'user', authorId: 'usr_1', ...overrides });

  it('separates a permanently dead delivery from one still being retried', () => {
    expect(deliveryFailure(outgoing({ deliveryStatus: 'dead' }))).toBe('dead');
    expect(deliveryFailure(outgoing({ deliveryStatus: 'failed' }))).toBe('failed');
  });

  it('treats a rate-limit deferral as healthy even though it carries an error', () => {
    expect(
      deliveryFailure(
        outgoing({ deliveryStatus: 'queued', deliveryError: 'rate_limited: hourly cap reached' }),
      ),
    ).toBeNull();
  });

  it('stays silent for a delivered message and for one with no delivery at all', () => {
    expect(deliveryFailure(outgoing({ deliveryStatus: 'sent' }))).toBeNull();
    expect(deliveryFailure(outgoing())).toBeNull();
  });

  it('ignores inbound messages and internal notes, which are never delivered', () => {
    expect(deliveryFailure(message({ deliveryStatus: 'dead' }))).toBeNull();
    expect(deliveryFailure(outgoing({ deliveryStatus: 'dead', internal: true }))).toBeNull();
  });
});
