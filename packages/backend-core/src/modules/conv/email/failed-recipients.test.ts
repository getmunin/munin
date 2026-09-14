import { describe, expect, it } from 'vitest';
import { extractFailedRecipients } from './failed-recipients.ts';

function headers(...lines: string[]): Array<{ key: string; line: string }> {
  return lines.map((line) => ({ key: line.split(':')[0]!.toLowerCase(), line }));
}

const DSN = [
  'Reporting-MTA: dns; mail.example.no',
  '',
  'Final-Recipient: rfc822; ola.nordmann@example.no',
  'Action: failed',
  'Status: 5.1.1',
  'Diagnostic-Code: smtp; 550 5.1.1 User unknown',
].join('\r\n');

describe('extractFailedRecipients', () => {
  it('reads the recipient out of an RFC 3464 delivery-status part', () => {
    expect(
      extractFailedRecipients({ headerLines: [], deliveryStatusParts: [DSN], bodyText: '' }),
    ).toEqual(['ola.nordmann@example.no']);
  });

  it('reads a comma-separated X-Failed-Recipients header', () => {
    expect(
      extractFailedRecipients({
        headerLines: headers('X-Failed-Recipients: A@Example.no, b@example.no'),
        deliveryStatusParts: [],
        bodyText: '',
      }),
    ).toEqual(['a@example.no', 'b@example.no']);
  });

  it('takes every failed recipient in a multi-recipient report and skips the delivered ones', () => {
    const report = [
      'Reporting-MTA: dns; mail.example.no',
      '',
      'Final-Recipient: rfc822; gone@example.no',
      'Action: failed',
      'Status: 5.1.1',
      '',
      'Final-Recipient: rfc822; fine@example.no',
      'Action: delivered',
      'Status: 2.0.0',
    ].join('\n');
    expect(
      extractFailedRecipients({ headerLines: [], deliveryStatusParts: [report], bodyText: '' }),
    ).toEqual(['gone@example.no']);
  });

  it('falls back to the body when the report was not carried as its own part', () => {
    expect(
      extractFailedRecipients({ headerLines: [], deliveryStatusParts: [], bodyText: DSN }),
    ).toEqual(['ola.nordmann@example.no']);
  });

  it('names nobody when the notice is prose without a recipient', () => {
    expect(
      extractFailedRecipients({
        headerLines: [],
        deliveryStatusParts: [],
        bodyText: 'We are sorry, but the email address you have tried to reach does not exist.',
      }),
    ).toEqual([]);
  });

  it('ignores a recipient whose block reports a temporary failure', () => {
    const report = [
      'Final-Recipient: rfc822; busy@example.no',
      'Action: delayed',
      'Status: 4.2.2',
    ].join('\n');
    expect(
      extractFailedRecipients({ headerLines: [], deliveryStatusParts: [report], bodyText: '' }),
    ).toEqual([]);
  });
});
