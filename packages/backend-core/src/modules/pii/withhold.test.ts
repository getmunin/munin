import { describe, expect, it } from 'vitest';
import { WITHHELD_TEXT, collectSubjectIds, withholdUncheckedText } from './withhold.ts';

const CHECKED = 'cvm_0000000000000000000001';
const UNCHECKED = 'cvm_0000000000000000000002';
const CONVERSATION = 'ccv_0000000000000000000001';

const conversation = {
  id: CONVERSATION,
  subject: 'Pakken til naboen',
  lastInboundPreview: 'Naboen tok imot pakken',
  status: 'open',
  messages: [
    { id: CHECKED, authorType: 'end_user', body: 'Checked text', createdAt: '2026-09-01T00:00:00Z' },
    {
      id: UNCHECKED,
      conversationId: CONVERSATION,
      authorType: 'end_user',
      authorName: 'Kari Nordmann',
      body: 'Unchecked text',
      internal: false,
      metadata: { quotedThread: [{ body: 'quoted', subject: 'Re: pakke' }], messageIdHeader: '<x@example.no>' },
      attachments: [{ id: 'cva_1', name: 'faktura.pdf', mime: 'application/pdf', sizeBytes: 12 }],
      createdAt: '2026-09-02T00:00:00Z',
    },
  ],
};

describe('collectSubjectIds', () => {
  it('finds every message and conversation id in a result', () => {
    expect(collectSubjectIds(conversation)).toEqual({
      messages: [CHECKED, UNCHECKED],
      conversations: [CONVERSATION],
    });
  });
});

describe('withholdUncheckedText', () => {
  it('withholds free text in unchecked messages and keeps their structure', () => {
    const { value, withheld } = withholdUncheckedText(conversation, {
      messages: new Set([UNCHECKED]),
      conversations: new Set([CONVERSATION]),
    });
    expect(withheld).toBe(1);
    const out = value as typeof conversation;
    expect(out.messages[0]).toEqual(conversation.messages[0]);
    expect(out.messages[1]).toEqual({
      id: UNCHECKED,
      conversationId: CONVERSATION,
      authorType: 'end_user',
      authorName: 'Kari Nordmann',
      body: WITHHELD_TEXT,
      internal: false,
      metadata: {
        quotedThread: [{ body: WITHHELD_TEXT, subject: WITHHELD_TEXT }],
        messageIdHeader: WITHHELD_TEXT,
      },
      attachments: [{ id: 'cva_1', name: WITHHELD_TEXT, mime: 'application/pdf', sizeBytes: 12 }],
      createdAt: '2026-09-02T00:00:00Z',
    });
  });

  it('withholds the subject and preview of a conversation that is not fully checked', () => {
    const { value } = withholdUncheckedText(conversation, {
      messages: new Set(),
      conversations: new Set([CONVERSATION]),
    });
    const out = value as typeof conversation;
    expect(out.subject).toBe(WITHHELD_TEXT);
    expect(out.lastInboundPreview).toBe(WITHHELD_TEXT);
    expect(out.status).toBe('open');
  });

  it('withholds a record that points at an unchecked message, such as an attachment row', () => {
    const { value, withheld } = withholdUncheckedText(
      [{ id: 'cva_2', messageId: UNCHECKED, name: 'Kari-Nordmann.pdf' }],
      { messages: new Set([UNCHECKED]), conversations: new Set() },
    );
    expect(withheld).toBe(1);
    expect(value).toEqual([{ id: 'cva_2', messageId: UNCHECKED, name: WITHHELD_TEXT }]);
  });

  it('leaves everything alone when nothing is unchecked', () => {
    expect(
      withholdUncheckedText(conversation, { messages: new Set(), conversations: new Set() }),
    ).toEqual({ value: conversation, withheld: 0 });
  });
});
