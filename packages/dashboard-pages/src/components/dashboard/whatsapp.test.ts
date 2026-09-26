import { describe, expect, it } from 'vitest';
import {
  EMPTY_TEMPLATE_VALUES,
  missingTemplateFields,
  readReceipt,
  readWhatsAppMessageMeta,
  renderTemplatePreview,
  splitRemaining,
  substitutePlaceholders,
  templateFields,
  templateKey,
  templateSendBody,
  whatsappWindowState,
  type WhatsAppTemplateOption,
} from './whatsapp';

const NOW = Date.parse('2026-03-01T12:00:00.000Z');

function template(overrides: Partial<WhatsAppTemplateOption> = {}): WhatsAppTemplateOption {
  return {
    name: 'order_update',
    language: 'en_US',
    category: 'UTILITY',
    status: 'APPROVED',
    parameterFormat: 'positional',
    headerText: 'Order {{1}}',
    bodyText: 'Hi {{1}}, your order ships on {{2}}.',
    footerText: 'Acme support',
    buttons: [
      { type: 'QUICK_REPLY', text: 'Thanks' },
      { type: 'URL', text: null },
    ],
    variables: ['1', '2'],
    headerVariables: ['1'],
    ...overrides,
  };
}

describe('whatsappWindowState', () => {
  it('returns null when the conversation carries no window', () => {
    expect(whatsappWindowState(undefined, NOW)).toBeNull();
    expect(whatsappWindowState(null, NOW)).toBeNull();
  });

  it('counts down to closesAt while the window is open', () => {
    const state = whatsappWindowState(
      { open: true, closesAt: '2026-03-01T14:30:00.000Z', lastInboundAt: '2026-02-28T14:30:00.000Z' },
      NOW,
    );
    expect(state).toEqual({ open: true, remainingMs: 150 * 60_000 });
  });

  it('treats a window whose closesAt has passed locally as closed even if the server said open', () => {
    const state = whatsappWindowState(
      { open: true, closesAt: '2026-03-01T11:59:00.000Z', lastInboundAt: '2026-02-28T11:59:00.000Z' },
      NOW,
    );
    expect(state).toEqual({ open: false, remainingMs: null });
  });

  it('falls back to the server flag when there is no closesAt', () => {
    expect(whatsappWindowState({ open: false, closesAt: null, lastInboundAt: null }, NOW)).toEqual({
      open: false,
      remainingMs: null,
    });
  });
});

describe('splitRemaining', () => {
  it('rounds partial minutes up so the countdown never shows zero while open', () => {
    expect(splitRemaining(150 * 60_000)).toEqual({ hours: 2, minutes: 30 });
    expect(splitRemaining(59 * 60_000 + 1)).toEqual({ hours: 1, minutes: 0 });
    expect(splitRemaining(1_000)).toEqual({ hours: 0, minutes: 1 });
  });
});

describe('template form', () => {
  it('orders header placeholders before body placeholders', () => {
    expect(templateFields(template())).toEqual([
      { scope: 'header', name: '1' },
      { scope: 'body', name: '1' },
      { scope: 'body', name: '2' },
    ]);
  });

  it('keys templates by name and language so translations of one template stay distinct', () => {
    expect(templateKey(template())).toBe('order_update::en_US');
    expect(templateKey(template({ language: 'nb' }))).toBe('order_update::nb');
  });

  it('reports blank and whitespace-only placeholders as missing', () => {
    const missing = missingTemplateFields(template(), {
      header: { '1': 'A-100' },
      body: { '1': '  ', '2': 'Tuesday' },
    });
    expect(missing).toEqual([{ scope: 'body', name: '1' }]);
  });

  it('builds a send body with only the placeholder groups the template declares', () => {
    expect(
      templateSendBody(template({ headerVariables: [], headerText: null }), {
        header: { '1': 'ignored' },
        body: { '1': ' Kari ', '2': 'Tuesday', '3': 'stray' },
      }),
    ).toEqual({
      templateName: 'order_update',
      language: 'en_US',
      variables: { '1': 'Kari', '2': 'Tuesday' },
    });
    expect(
      templateSendBody(template({ variables: [], headerVariables: [] }), EMPTY_TEMPLATE_VALUES),
    ).toEqual({ templateName: 'order_update', language: 'en_US' });
  });
});

describe('template preview', () => {
  it('substitutes named and positional placeholders and leaves unfilled ones visible', () => {
    expect(substitutePlaceholders('Hi {{ first_name }}, ref {{2}}', { first_name: 'Ola' })).toBe(
      'Hi Ola, ref {{2}}',
    );
  });

  it('renders header, body, footer and labelled buttons', () => {
    expect(
      renderTemplatePreview(template(), {
        header: { '1': 'A-100' },
        body: { '1': 'Kari', '2': '' },
      }),
    ).toEqual({
      header: 'Order A-100',
      body: 'Hi Kari, your order ships on {{2}}.',
      footer: 'Acme support',
      buttons: ['Thanks'],
    });
  });
});

describe('readWhatsAppMessageMeta', () => {
  it('reads a template send', () => {
    expect(
      readWhatsAppMessageMeta({
        whatsappTemplate: { name: 'hello_world', language: 'en_US', parameterFormat: 'positional' },
      }).template,
    ).toEqual({ name: 'hello_world', language: 'en_US' });
  });

  it('maps voice-note transcription states and treats a missing status as pending', () => {
    expect(readWhatsAppMessageMeta({ voiceNote: true }).voiceNote).toEqual({ status: 'pending' });
    expect(
      readWhatsAppMessageMeta({ voiceNote: true, transcription: { status: 'done' } }).voiceNote,
    ).toEqual({ status: 'done' });
    expect(
      readWhatsAppMessageMeta({
        voiceNote: true,
        transcription: { status: 'failed', error: 'no speech detected' },
      }).voiceNote,
    ).toEqual({ status: 'failed', error: 'no speech detected' });
  });

  it('ignores a transcription record on a message that is not a voice note', () => {
    expect(readWhatsAppMessageMeta({ transcription: { status: 'done' } }).voiceNote).toBeNull();
  });

  it('reads a reaction emoji and ignores malformed ones', () => {
    expect(
      readWhatsAppMessageMeta({ whatsappReaction: { emoji: '👍', from: '+4712345678', at: '' } })
        .reaction,
    ).toBe('👍');
    expect(readWhatsAppMessageMeta({ whatsappReaction: { emoji: '' } }).reaction).toBeNull();
    expect(readWhatsAppMessageMeta({ whatsappReaction: 'x' }).reaction).toBeNull();
  });
});

describe('readReceipt', () => {
  it('prefers a widget seen receipt', () => {
    expect(
      readReceipt({ seenAt: '2026-03-01T10:00:00Z', firstOpenedAt: '2026-03-01T09:00:00Z' }, 'chat'),
    ).toEqual({ kind: 'seen', at: '2026-03-01T10:00:00Z' });
  });

  it('shows a WhatsApp read receipt from firstOpenedAt', () => {
    expect(readReceipt({ seenAt: null, firstOpenedAt: '2026-03-01T09:00:00Z' }, 'whatsapp')).toEqual(
      { kind: 'read', at: '2026-03-01T09:00:00Z' },
    );
  });

  it('does not treat an email open pixel as a read receipt', () => {
    expect(readReceipt({ seenAt: null, firstOpenedAt: '2026-03-01T09:00:00Z' }, 'email')).toBeNull();
  });
});
