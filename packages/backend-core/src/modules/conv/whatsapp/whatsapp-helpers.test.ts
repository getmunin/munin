import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  deriveVerifyToken,
  extractTemplatePlaceholders,
  toWaRecipient,
  verifyMetaSignature,
  type MetaTemplate,
} from './meta-graph-client.service.ts';
import { answerChallenge } from './meta-whatsapp-adapter.ts';
import {
  readWhatsAppTemplateSend,
  renderTemplateText,
  toTemplateDto,
  toTemplateSendParameters,
  validateTemplateVariables,
} from './whatsapp-templates.ts';
import { WHATSAPP_WINDOW_MS, computeWhatsAppWindow } from './whatsapp-window.ts';

const PEPPER = 'test-pepper';

describe('computeWhatsAppWindow', () => {
  const now = new Date('2026-09-25T12:00:00Z');

  it('is closed when the contact never wrote', () => {
    expect(computeWhatsAppWindow(null, now)).toEqual({ open: false, closesAt: null, lastInboundAt: null });
  });

  it('is open for 24 hours after the last inbound message', () => {
    const last = new Date(now.getTime() - WHATSAPP_WINDOW_MS + 60_000);
    expect(computeWhatsAppWindow(last, now)).toMatchObject({ open: true });
  });

  it('closes exactly 24 hours after the last inbound message', () => {
    const last = new Date(now.getTime() - WHATSAPP_WINDOW_MS);
    const window = computeWhatsAppWindow(last, now);
    expect(window.open).toBe(false);
    expect(window.closesAt).toBe(now.toISOString());
  });
});

describe('verifyMetaSignature', () => {
  const body = Buffer.from('{"entry":[]}');
  const good = `sha256=${createHmac('sha256', 'app-secret').update(body).digest('hex')}`;

  it('accepts the app-secret HMAC of the raw body', () => {
    expect(verifyMetaSignature({ appSecret: 'app-secret', rawBody: body, signatureHeader: good })).toBe(true);
  });

  it('rejects another secret, a tampered body, and malformed headers', () => {
    expect(verifyMetaSignature({ appSecret: 'other', rawBody: body, signatureHeader: good })).toBe(false);
    expect(
      verifyMetaSignature({ appSecret: 'app-secret', rawBody: Buffer.from('{}'), signatureHeader: good }),
    ).toBe(false);
    expect(verifyMetaSignature({ appSecret: 'app-secret', rawBody: body, signatureHeader: 'sha1=abc' })).toBe(false);
  });
});

describe('webhook verification challenge', () => {
  const token = deriveVerifyToken('cch_1', PEPPER);

  function request(query: Record<string, string>) {
    return { headers: {}, rawBody: Buffer.alloc(0), query };
  }

  it('derives a stable per-channel token', () => {
    expect(deriveVerifyToken('cch_1', PEPPER)).toBe(token);
    expect(deriveVerifyToken('cch_2', PEPPER)).not.toBe(token);
    expect(() => deriveVerifyToken('cch_1', '')).toThrow(/MUNIN_KEY_PEPPER/);
  });

  it('echoes the challenge only for the channel’s own token', () => {
    process.env.MUNIN_KEY_PEPPER = PEPPER;
    try {
      expect(
        answerChallenge(
          request({ 'hub.mode': 'subscribe', 'hub.verify_token': token, 'hub.challenge': '1158201444' }),
          'cch_1',
        ),
      ).toMatchObject({ status: 200, body: '1158201444' });
      expect(
        answerChallenge(
          request({ 'hub.mode': 'subscribe', 'hub.verify_token': token, 'hub.challenge': '1' }),
          'cch_2',
        ),
      ).toBeNull();
      expect(
        answerChallenge(request({ 'hub.mode': 'unsubscribe', 'hub.verify_token': token, 'hub.challenge': '1' }), 'cch_1'),
      ).toBeNull();
    } finally {
      delete process.env.MUNIN_KEY_PEPPER;
    }
  });
});

describe('template helpers', () => {
  const positional: MetaTemplate = {
    id: 't1',
    name: 'order_update',
    language: 'en_US',
    status: 'approved',
    category: 'utility',
    parameterFormat: 'positional',
    components: [
      { type: 'header', format: 'text', text: 'Order {{1}}' },
      { type: 'body', text: 'Hi {{1}}, your order is {{2}}.' },
      { type: 'footer', text: 'Acme' },
      { type: 'buttons', buttons: [{ type: 'quick_reply', text: 'Thanks' }] },
    ],
  };

  it('lists body and header placeholders', () => {
    const dto = toTemplateDto(positional);
    expect(dto.variables).toEqual(['1', '2']);
    expect(dto.headerVariables).toEqual(['1']);
    expect(dto.buttons).toEqual([{ type: 'quick_reply', text: 'Thanks' }]);
    expect(extractTemplatePlaceholders('Hi {{ name }} and {{name}}')).toEqual(['name']);
  });

  it('reports missing and unknown placeholders', () => {
    const dto = toTemplateDto(positional);
    expect(validateTemplateVariables(dto, { '1': 'Kari' }, { '1': 'A-1' })).toMatch(/missing \{\{2\}\}/);
    expect(validateTemplateVariables(dto, { '1': 'Kari', '2': 'shipped', '3': 'x' }, { '1': 'A-1' })).toMatch(
      /unknown \{\{3\}\}/,
    );
    expect(validateTemplateVariables(dto, { '1': 'Kari', '2': 'shipped' }, { '1': 'A-1' })).toBeNull();
    expect(validateTemplateVariables(dto, { '1': 'Kari', '2': 'line\nbreak' }, { '1': 'A-1' })).toMatch(/newline/);
  });

  it('renders the text the customer receives', () => {
    const dto = toTemplateDto(positional);
    expect(renderTemplateText(dto, { '1': 'Kari', '2': 'shipped' }, { '1': 'A-1' })).toBe(
      'Order A-1\n\nHi Kari, your order is shipped.\n\nAcme',
    );
  });

  it('orders positional parameters numerically and names named ones', () => {
    expect(
      toTemplateSendParameters({
        name: 'x',
        language: 'en',
        parameterFormat: 'positional',
        variables: { '10': 'j', '2': 'b', '1': 'a' },
      }),
    ).toEqual({ header: [], body: [{ text: 'a' }, { text: 'b' }, { text: 'j' }] });
    expect(
      toTemplateSendParameters({
        name: 'x',
        language: 'en',
        parameterFormat: 'named',
        variables: { first_name: 'Kari' },
      }).body,
    ).toEqual([{ name: 'first_name', text: 'Kari' }]);
  });

  it('reads only well-formed template metadata off a message', () => {
    expect(readWhatsAppTemplateSend({})).toBeNull();
    expect(readWhatsAppTemplateSend({ whatsappTemplate: { name: 'x' } })).toBeNull();
    expect(
      readWhatsAppTemplateSend({
        whatsappTemplate: { name: 'x', language: 'en', parameterFormat: 'positional', variables: {} },
      }),
    ).toMatchObject({ name: 'x' });
  });
});

describe('toWaRecipient', () => {
  it('sends digits only', () => {
    expect(toWaRecipient('+47 123 45 678')).toBe('4712345678');
  });
});
