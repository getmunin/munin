import { describe, expect, it } from 'vitest';
import { buildOutbound } from './mime.ts';

const base = {
  from: 'Acme <hello@acme.test>',
  to: 'kari@example.com',
  subject: 'What is new in October',
  text: 'Three things shipped this month.',
  messageIdDomain: 'acme.test',
};

const URL = 'https://api.acme.test/v1/outreach/unsubscribe?token=v1.org_a.cct_b.cmp_c.1.sig';

describe('List-Unsubscribe on outbound', () => {
  it('omits the headers unless the send carries an unsubscribe URL', () => {
    const raw = buildOutbound(base).raw;
    expect(raw).not.toMatch(/^List-Unsubscribe:/im);
    expect(raw).not.toMatch(/^List-Unsubscribe-Post:/im);
  });

  it('advertises RFC 8058 one-click unsubscribe', () => {
    const raw = buildOutbound({ ...base, listUnsubscribeUrl: URL }).raw;
    expect(raw).toContain(`\r\nList-Unsubscribe: <${URL}>\r\n`);
    expect(raw).toContain('\r\nList-Unsubscribe-Post: List-Unsubscribe=One-Click\r\n');
  });
});
