import { describe, expect, it } from 'vitest';
import {
  parseAddressLine,
  parseAddressList,
  parseManualForward,
  resolveForwardOrigin,
} from './forwarded-sender.ts';
import type { ParsedInboundEmail } from './threading.ts';

const RELAY = 'acme-7f3c@in.getmunin.com';

function parsed(overrides: Partial<ParsedInboundEmail>): ParsedInboundEmail {
  return {
    recipients: [],
    fromAddress: 'customer@example.com',
    fromName: 'Customer',
    subject: 'Help please',
    messageId: 'mid-1',
    inReplyTo: null,
    references: [],
    bodyText: 'I need help with my order.',
    bodyHtml: null,
    senderClassification: {
      isMailingList: false,
      isAutoReply: false,
      isRoleAccount: false,
      isNoReplyAddress: false,
      isBounce: false,
      autoReplySignal: null,
    },
    authenticationResults: [],
    arcAuthenticationResults: [],
    forwardedFor: [],
    forwardedTo: [],
    failedRecipients: [],
    attachments: [],
    ...overrides,
  };
}

describe('parseAddressLine', () => {
  it('reads an angle-bracketed address with a display name', () => {
    expect(parseAddressLine(' Kari Nordmann <kari@example.com>')).toEqual({
      address: 'kari@example.com',
      name: 'Kari Nordmann',
    });
  });

  it('drops a placeholder display name so the address is what shows', () => {
    expect(parseAddressLine('? <kari@example.com>')).toEqual({
      address: 'kari@example.com',
      name: null,
    });
  });

  it('strips the mailto: prefix Outlook adds', () => {
    expect(parseAddressLine('Kari Nordmann <mailto:kari@example.com>')).toEqual({
      address: 'kari@example.com',
      name: 'Kari Nordmann',
    });
  });

  it('reads a bare address', () => {
    expect(parseAddressLine('kari@example.com')).toEqual({
      address: 'kari@example.com',
      name: null,
    });
  });

  it('drops surrounding quotes from the display name', () => {
    expect(parseAddressLine('"Nordmann, Kari" <kari@example.com>')?.name).toBe('Nordmann, Kari');
  });

  it('returns null when there is no address', () => {
    expect(parseAddressLine('Kari Nordmann')).toBeNull();
  });
});

describe('parseAddressList', () => {
  it('reads every address off a recipient line', () => {
    expect(parseAddressList('Kari <kari@example.com>; Ola <ola@example.com>')).toEqual([
      'kari@example.com',
      'ola@example.com',
    ]);
  });

  it('strips the mailto: prefix Outlook adds', () => {
    expect(parseAddressList('Kari Nordmann <mailto:kari@example.com>')).toEqual([
      'kari@example.com',
    ]);
  });

  it('returns nothing for a line with no address', () => {
    expect(parseAddressList('Kari Nordmann')).toEqual([]);
  });
});

describe('parseManualForward', () => {
  it('reads the original sender out of a Gmail forward', () => {
    const body = [
      'Can you look at this?',
      '',
      '---------- Forwarded message ---------',
      'From: Kari Nordmann <kari@example.com>',
      'Date: Mon, 1 Sep 2025 at 10:00',
      'Subject: Help please',
      'To: <support@acme.com>',
      '',
      'My order never arrived.',
    ].join('\n');
    expect(parseManualForward(body, 'Fwd: Help please')).toEqual({
      address: 'kari@example.com',
      name: 'Kari Nordmann',
      recipients: ['support@acme.com'],
    });
  });

  it('reads an Apple Mail forward', () => {
    const body = [
      'FYI',
      '',
      'Begin forwarded message:',
      '',
      'From: Kari Nordmann <kari@example.com>',
      'Subject: Help please',
    ].join('\n');
    expect(parseManualForward(body, 'Fwd: Help please')?.address).toBe('kari@example.com');
  });

  it('reads an Outlook original-message block', () => {
    const body = [
      '-----Original Message-----',
      'From: Kari Nordmann <kari@example.com>',
      'Sent: Monday, 1 September 2025 10:00',
      'To: support@acme.com',
      'Subject: Help please',
    ].join('\n');
    expect(parseManualForward(body, 'FW: Help please')?.address).toBe('kari@example.com');
  });

  it('reads a Norwegian Outlook forward', () => {
    const body = [
      'Kan du se på denne?',
      '',
      '-------- Videresendt melding --------',
      'Fra: Kari Nordmann <kari@example.com>',
      'Sendt: mandag 1. september 2025 10:00',
      'Til: support@acme.com',
      'Emne: Trenger hjelp',
    ].join('\n');
    expect(parseManualForward(body, 'VS: Trenger hjelp')).toEqual({
      address: 'kari@example.com',
      name: 'Kari Nordmann',
      recipients: ['support@acme.com'],
    });
  });

  it('reads the Outlook divider-only block via the subject prefix', () => {
    const body = [
      '________________________________',
      'Fra: Kari Nordmann <kari@example.com>',
      'Sendt: 1. september 2025 10:00',
      'Til: support@acme.com',
    ].join('\n');
    expect(parseManualForward(body, 'VS: Trenger hjelp')?.address).toBe('kari@example.com');
  });

  it('ignores quoted reply history that is not a forward', () => {
    const body = [
      'Thanks, that worked.',
      '',
      'On Mon, 1 Sep 2025, Support wrote:',
      '> Try this.',
    ].join('\n');
    expect(parseManualForward(body, 'Re: Help please')).toBeNull();
  });

  it('does not treat a plain body as a forward just because the subject says Fwd', () => {
    expect(parseManualForward('No headers in here at all.', 'Fwd: something')).toBeNull();
  });
});

describe('resolveForwardOrigin', () => {
  it('treats mail sent straight to the relay address as direct', () => {
    const origin = resolveForwardOrigin(parsed({ recipients: [`Acme <${RELAY}>`] }), RELAY);
    expect(origin).toEqual({
      kind: 'direct',
      senderAddress: 'customer@example.com',
      senderName: 'Customer',
      forwardedBy: null,
    });
  });

  it('keeps the original sender when a server auto-forwarded the message', () => {
    const origin = resolveForwardOrigin(
      parsed({
        recipients: ['support@acme.com', RELAY],
        forwardedFor: [`support@acme.com ${RELAY}`],
      }),
      RELAY,
    );
    expect(origin.kind).toBe('auto-forward');
    expect(origin.senderAddress).toBe('customer@example.com');
    expect(origin.forwardedBy).toBe('support@acme.com');
  });

  it('detects an auto-forward from Delivered-To alone', () => {
    const origin = resolveForwardOrigin(
      parsed({ recipients: ['Support <support@acme.com>'] }),
      RELAY,
    );
    expect(origin.kind).toBe('auto-forward');
    expect(origin.senderAddress).toBe('customer@example.com');
    expect(origin.forwardedBy).toBe('support@acme.com');
  });

  it('attributes a manual forward to the original sender, not the operator', () => {
    const origin = resolveForwardOrigin(
      parsed({
        fromAddress: 'ops@acme.com',
        fromName: 'Acme Ops',
        subject: 'Fwd: Help please',
        recipients: [RELAY],
        bodyText: [
          'Please handle.',
          '',
          '---------- Forwarded message ---------',
          'From: Kari Nordmann <kari@example.com>',
          'To: support@acme.com',
          '',
          'My order never arrived.',
        ].join('\n'),
      }),
      RELAY,
    );
    expect(origin).toEqual({
      kind: 'manual-forward',
      senderAddress: 'kari@example.com',
      senderName: 'Kari Nordmann',
      forwardedBy: 'ops@acme.com',
    });
  });

  it('stays direct when an Outlook reply quotes the mail the sender is answering', () => {
    const origin = resolveForwardOrigin(
      parsed({
        fromAddress: 'ola@example.com',
        fromName: 'Ola',
        subject: 'Survey response: nei',
        recipients: [RELAY],
        bodyText: [
          'nei',
          '',
          '________________________________',
          'Fra: Acme <support@acme.com>',
          'Sendt: mandag 14. september 2026 16:11',
          'Til: Ola <ola@example.com>',
          'Emne: Har du 1 minutt til overs?',
        ].join('\n'),
      }),
      RELAY,
      ['support@acme.com'],
    );
    expect(origin.kind).toBe('direct');
    expect(origin.senderAddress).toBe('ola@example.com');
  });

  it('stays direct when the quoted block cc-s the sender rather than addressing them', () => {
    const origin = resolveForwardOrigin(
      parsed({
        fromAddress: 'ola@example.com',
        subject: 'Sv: Har du 1 minutt til overs?',
        recipients: [RELAY],
        bodyText: [
          'nei',
          '',
          '________________________________',
          'Fra: Acme <support@acme.com>',
          'Sendt: mandag 14. september 2026 16:11',
          'Til: Ola <ola@example.com>',
          'Kopi: Ola <ola@example.com>',
        ].join('\n'),
      }),
      RELAY,
      ['support@acme.com'],
    );
    expect(origin.kind).toBe('direct');
    expect(origin.senderAddress).toBe('ola@example.com');
  });

  it('never attributes a message to the channel\'s own address', () => {
    const origin = resolveForwardOrigin(
      parsed({
        fromAddress: 'ola@example.com',
        subject: 'VS: Har du 1 minutt til overs?',
        recipients: [RELAY],
        bodyText: [
          '________________________________',
          'Fra: Acme <support@acme.com>',
          'Sendt: mandag 14. september 2026 16:11',
          'Emne: Har du 1 minutt til overs?',
        ].join('\n'),
      }),
      RELAY,
      ['support@acme.com'],
    );
    expect(origin.kind).toBe('direct');
    expect(origin.senderAddress).toBe('ola@example.com');
  });

  it('never attributes a message to the relay address', () => {
    const origin = resolveForwardOrigin(
      parsed({
        fromAddress: 'ola@example.com',
        subject: 'VS: Har du 1 minutt til overs?',
        recipients: [RELAY],
        bodyText: ['---------- Forwarded message ---------', `From: Acme <${RELAY}>`].join('\n'),
      }),
      RELAY,
    );
    expect(origin.kind).toBe('direct');
    expect(origin.senderAddress).toBe('ola@example.com');
  });

  it('still attributes a genuine forward the operator sent on behalf of a customer', () => {
    const origin = resolveForwardOrigin(
      parsed({
        fromAddress: 'ops@acme.com',
        subject: 'VS: Trenger hjelp',
        recipients: [RELAY],
        bodyText: [
          'Kan dere se på denne?',
          '',
          '________________________________',
          'Fra: Kari Nordmann <kari@example.com>',
          'Sendt: mandag 14. september 2026 16:11',
          'Til: Acme <support@acme.com>',
          'Emne: Trenger hjelp',
        ].join('\n'),
      }),
      RELAY,
      ['support@acme.com'],
    );
    expect(origin.kind).toBe('manual-forward');
    expect(origin.senderAddress).toBe('kari@example.com');
    expect(origin.forwardedBy).toBe('ops@acme.com');
  });

  it('stays direct when the forwarded block names the same sender as the header', () => {
    const origin = resolveForwardOrigin(
      parsed({
        recipients: [RELAY],
        subject: 'Fwd: Help please',
        bodyText: [
          '---------- Forwarded message ---------',
          'From: Customer <customer@example.com>',
          '',
          'My order never arrived.',
        ].join('\n'),
      }),
      RELAY,
    );
    expect(origin.kind).toBe('direct');
    expect(origin.senderAddress).toBe('customer@example.com');
  });
});
