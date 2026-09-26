import { describe, expect, it } from 'vitest';
import { WHATSAPP_VOICE_NOTE_PLACEHOLDER, parseMetaWebhook, toE164 } from './meta-webhook-payload.ts';

const PHONE_NUMBER_ID = '1000000001';

function payload(value: Record<string, unknown>, phoneNumberId = PHONE_NUMBER_ID) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'waba_1',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '4712345678', phone_number_id: phoneNumberId },
              ...value,
            },
          },
        ],
      },
    ],
  };
}

const contact = { profile: { name: 'Kari Nordmann' }, wa_id: '4712345678' };

describe('parseMetaWebhook', () => {
  it('parses a text message with the sender profile name and E.164 phone', () => {
    const parsed = parseMetaWebhook(
      payload({
        contacts: [contact],
        messages: [
          { from: '4712345678', id: 'wamid.A', timestamp: '1790000000', type: 'text', text: { body: 'Hei!' } },
        ],
      }),
      PHONE_NUMBER_ID,
    );
    expect(parsed.messages).toHaveLength(1);
    expect(parsed.messages[0]).toMatchObject({
      wamid: 'wamid.A',
      from: '+4712345678',
      name: 'Kari Nordmann',
      kind: 'text',
      body: 'Hei!',
      media: null,
    });
    expect(parsed.messages[0]!.receivedAt.toISOString()).toBe(new Date(1790000000 * 1000).toISOString());
  });

  it('ignores changes addressed to another phone number on the same app', () => {
    const parsed = parseMetaWebhook(
      payload(
        { messages: [{ from: '4712345678', id: 'wamid.B', type: 'text', text: { body: 'x' } }] },
        '2000000002',
      ),
      PHONE_NUMBER_ID,
    );
    expect(parsed.messages).toHaveLength(0);
  });

  it('keeps image media references and uses the caption as body', () => {
    const parsed = parseMetaWebhook(
      payload({
        messages: [
          {
            from: '4712345678',
            id: 'wamid.IMG',
            type: 'image',
            image: { id: 'media_1', mime_type: 'image/jpeg', caption: 'Broken lid' },
          },
        ],
      }),
      PHONE_NUMBER_ID,
    );
    expect(parsed.messages[0]).toMatchObject({ kind: 'image', body: 'Broken lid' });
    expect(parsed.messages[0]!.media).toMatchObject({ id: 'media_1', mime: 'image/jpeg' });
    expect(parsed.messages[0]!.media!.name).toMatch(/\.jpg$/);
  });

  it('marks audio as a voice note with a placeholder body', () => {
    const parsed = parseMetaWebhook(
      payload({
        messages: [
          {
            from: '4712345678',
            id: 'wamid.VOICE',
            type: 'audio',
            audio: { id: 'media_2', mime_type: 'audio/ogg; codecs=opus', voice: true },
          },
        ],
      }),
      PHONE_NUMBER_ID,
    );
    expect(parsed.messages[0]).toMatchObject({
      kind: 'audio',
      body: WHATSAPP_VOICE_NOTE_PLACEHOLDER,
      metadata: { voiceNote: true },
    });
    expect(parsed.messages[0]!.media!.name).toMatch(/\.ogg$/);
  });

  it('turns interactive and template button replies into text with the payload in metadata', () => {
    const parsed = parseMetaWebhook(
      payload({
        messages: [
          {
            from: '4712345678',
            id: 'wamid.I',
            type: 'interactive',
            interactive: { type: 'button_reply', button_reply: { id: 'yes', title: 'Yes please' } },
          },
          {
            from: '4712345678',
            id: 'wamid.BTN',
            type: 'button',
            button: { text: 'Stop promotions', payload: 'Stop promotions' },
          },
        ],
      }),
      PHONE_NUMBER_ID,
    );
    expect(parsed.messages[0]).toMatchObject({
      body: 'Yes please',
      metadata: { interactiveReply: { id: 'yes', title: 'Yes please' } },
    });
    expect(parsed.messages[1]).toMatchObject({
      kind: 'button',
      body: 'Stop promotions',
      metadata: { optOutButton: true },
    });
  });

  it('describes attachments it cannot store', () => {
    const parsed = parseMetaWebhook(
      payload({
        messages: [
          { from: '4712345678', id: 'wamid.D', type: 'document', document: { id: 'm', filename: 'invoice.pdf' } },
          { from: '4712345678', id: 'wamid.L', type: 'location', location: { latitude: 59.9, longitude: 10.7, name: 'Office' } },
          { from: '4712345678', id: 'wamid.U', type: 'ephemeral' },
        ],
      }),
      PHONE_NUMBER_ID,
    );
    expect(parsed.messages.map((m) => m.body)).toEqual([
      '[Document: invoice.pdf]',
      '[Location: Office (59.9,10.7)]',
      '[Unsupported message]',
    ]);
  });

  it('separates reactions and status updates from messages', () => {
    const parsed = parseMetaWebhook(
      payload({
        messages: [
          {
            from: '4712345678',
            id: 'wamid.R',
            timestamp: '1790000100',
            type: 'reaction',
            reaction: { message_id: 'wamid.OUT', emoji: '👍' },
          },
        ],
        statuses: [
          { id: 'wamid.OUT', status: 'read', timestamp: '1790000050', recipient_id: '4712345678' },
          {
            id: 'wamid.OUT2',
            status: 'failed',
            timestamp: '1790000060',
            errors: [{ code: 131047, title: 'Re-engagement message', error_data: { details: 'window' } }],
          },
        ],
      }),
      PHONE_NUMBER_ID,
    );
    expect(parsed.messages).toHaveLength(0);
    expect(parsed.reactions).toEqual([
      expect.objectContaining({ targetWamid: 'wamid.OUT', emoji: '👍', from: '+4712345678' }),
    ]);
    expect(parsed.statuses[0]).toMatchObject({ wamid: 'wamid.OUT', status: 'read' });
    expect(parsed.statuses[1]).toMatchObject({
      status: 'failed',
      errors: [{ code: 131047, title: 'Re-engagement message', message: 'window' }],
    });
  });

  it('walks every entry and change in a batched delivery', () => {
    const one = payload({ messages: [{ from: '4712345678', id: 'wamid.1', type: 'text', text: { body: 'a' } }] });
    const two = payload({ messages: [{ from: '4712345678', id: 'wamid.2', type: 'text', text: { body: 'b' } }] });
    const parsed = parseMetaWebhook({ entry: [...one.entry, ...two.entry] }, PHONE_NUMBER_ID);
    expect(parsed.messages.map((m) => m.wamid)).toEqual(['wamid.1', 'wamid.2']);
  });

  it('tolerates junk without throwing', () => {
    expect(parseMetaWebhook(null, PHONE_NUMBER_ID)).toEqual({ messages: [], statuses: [], reactions: [] });
    expect(parseMetaWebhook({ entry: 'nope' }, PHONE_NUMBER_ID).messages).toEqual([]);
  });
});

describe('toE164', () => {
  it('adds the plus and strips formatting', () => {
    expect(toE164('4712345678')).toBe('+4712345678');
    expect(toE164('+47 123 45 678')).toBe('+4712345678');
  });
});
