import { describe, expect, it } from 'vitest';
import { buildOutbound } from './mime.ts';
import { parseMessage } from './email-adapter.ts';
import { suppressionReason } from './classify-sender.ts';

const base = {
  from: 'Support <support@acme.test>',
  to: 'support@acme.test',
  subject: 'Re: Munin test message — Support',
  text: 'Thanks for the confirmation — the channel is working correctly.',
  messageIdDomain: 'acme.test',
};

describe('Auto-Submitted on outbound', () => {
  it('omits the header unless the send asks for it', () => {
    expect(buildOutbound(base).raw).not.toMatch(/^Auto-Submitted:/im);
  });

  it('marks an auto-submitted send as auto-replied', () => {
    expect(buildOutbound({ ...base, autoSubmitted: true }).raw).toMatch(
      /^Auto-Submitted: auto-replied$/im,
    );
  });

  it('suppresses our own auto-submitted reply when it is delivered back to us', async () => {
    const built = buildOutbound({ ...base, autoSubmitted: true });
    const parsed = await parseMessage(built.raw);

    expect(parsed.senderClassification.isAutoReply).toBe(true);
    expect(parsed.senderClassification.autoReplySignal).toBe('auto_submitted');
    expect(suppressionReason(parsed.senderClassification)).toBe('auto_reply');
  });

  it('leaves an operator-typed reply delivered back to us answerable', async () => {
    const parsed = await parseMessage(buildOutbound(base).raw);

    expect(parsed.senderClassification.isAutoReply).toBe(false);
    expect(suppressionReason(parsed.senderClassification)).toBeNull();
  });
});
