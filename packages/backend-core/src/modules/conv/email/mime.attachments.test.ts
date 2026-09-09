import { describe, expect, it } from 'vitest';
import { buildOutbound } from './mime.ts';

const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d494844520000000100000001080600000' + '01f15c4890000000a49444154789c6300010000050001',
  'hex',
);

function boundaryOf(raw: string, subtype: string): string {
  const m = new RegExp(`multipart/${subtype}[^\\r\\n]*boundary="([^"]+)"`).exec(raw);
  if (!m) throw new Error(`no multipart/${subtype} in message`);
  return m[1]!;
}

function partsOf(raw: string, boundary: string): string[] {
  const body = raw.slice(raw.indexOf('\r\n\r\n') + 4);
  return body
    .split(`--${boundary}`)
    .slice(1)
    .filter((chunk) => chunk.trim() !== '--');
}

const base = {
  from: 'Support <support@acme.test>',
  to: 'c@customer.test',
  subject: 'Re: your order',
  text: 'here you go',
  messageIdDomain: 'acme.test',
};

describe('buildOutbound attachments', () => {
  it('keeps multipart/alternative at the top when there are no attachments', () => {
    const built = buildOutbound({ ...base, html: '<p>here you go</p>' });
    expect(built.raw).toContain('Content-Type: multipart/alternative;');
    expect(built.raw).not.toContain('multipart/mixed');
    expect(built.raw).not.toContain('multipart/related');
  });

  it('wraps the alternative in multipart/mixed and base64-encodes a plain attachment', () => {
    const built = buildOutbound({
      ...base,
      html: '<p>here you go</p>',
      attachments: [{ filename: 'receipt.png', contentType: 'image/png', content: PNG }],
    });

    expect(built.raw).toMatch(/^Content-Type: multipart\/mixed;/m);
    const mixed = boundaryOf(built.raw, 'mixed');
    const parts = partsOf(built.raw, mixed);
    expect(parts).toHaveLength(2);
    expect(parts[0]).toContain('Content-Type: multipart/alternative;');
    expect(parts[1]).toContain('Content-Type: image/png; name="receipt.png"');
    expect(parts[1]).toContain('Content-Transfer-Encoding: base64');
    expect(parts[1]).toContain('Content-Disposition: attachment; filename="receipt.png"');
    expect(parts[1]).not.toContain('Content-ID');

    const encoded = parts[1]!.slice(parts[1]!.indexOf('\r\n\r\n') + 4).trim();
    expect(Buffer.from(encoded.replace(/\r\n/g, ''), 'base64').equals(PNG)).toBe(true);
  });

  it('wraps the alternative in multipart/related for an inline part the html references', () => {
    const built = buildOutbound({
      ...base,
      html: '<p>see <img src="cid:shot@acme"></p>',
      attachments: [
        {
          filename: 'shot.png',
          contentType: 'image/png',
          content: PNG,
          inline: true,
          contentId: 'shot@acme',
        },
      ],
    });

    expect(built.raw).toMatch(/^Content-Type: multipart\/related; type="text\/html";/m);
    expect(built.raw).not.toContain('multipart/mixed');
    const related = boundaryOf(built.raw, 'related');
    const parts = partsOf(built.raw, related);
    expect(parts).toHaveLength(2);
    expect(parts[0]).toContain('Content-Type: multipart/alternative;');
    expect(parts[1]).toContain('Content-Disposition: inline; filename="shot.png"');
    expect(parts[1]).toContain('Content-ID: <shot@acme>');
  });

  it('nests mixed over related when a message carries both an inline image and a file', () => {
    const built = buildOutbound({
      ...base,
      html: '<p>see <img src="cid:shot@acme"></p>',
      attachments: [
        {
          filename: 'shot.png',
          contentType: 'image/png',
          content: PNG,
          inline: true,
          contentId: 'shot@acme',
        },
        { filename: 'receipt.png', contentType: 'image/png', content: PNG },
      ],
    });

    const mixed = boundaryOf(built.raw, 'mixed');
    const mixedParts = partsOf(built.raw, mixed);
    expect(mixedParts).toHaveLength(2);
    expect(mixedParts[0]).toContain('Content-Type: multipart/related; type="text/html";');
    expect(mixedParts[1]).toContain('Content-Disposition: attachment; filename="receipt.png"');
    expect(mixedParts[0]).toContain('Content-ID: <shot@acme>');
  });

  it('demotes an inline part to an attachment when the html does not reference its cid', () => {
    const built = buildOutbound({
      ...base,
      html: '<p>no image here</p>',
      attachments: [
        {
          filename: 'orphan.png',
          contentType: 'image/png',
          content: PNG,
          inline: true,
          contentId: 'orphan@acme',
        },
      ],
    });
    expect(built.raw).toContain('multipart/mixed');
    expect(built.raw).not.toContain('multipart/related');
    expect(built.raw).toContain('Content-Disposition: attachment; filename="orphan.png"');
    expect(built.raw).not.toContain('Content-ID:');
  });

  it('wraps base64 at 76 characters and rfc2231-encodes a non-ascii filename', () => {
    const big = Buffer.alloc(400, 7);
    const built = buildOutbound({
      ...base,
      attachments: [{ filename: 'kvittering-æøå.png', contentType: 'image/png', content: big }],
    });
    expect(built.raw).toContain(
      "Content-Disposition: attachment; filename*=utf-8''kvittering-%C3%A6%C3%B8%C3%A5.png",
    );
    const mixed = boundaryOf(built.raw, 'mixed');
    const attachmentPart = partsOf(built.raw, mixed)[1]!;
    const encoded = attachmentPart.slice(attachmentPart.indexOf('\r\n\r\n') + 4).trim();
    for (const line of encoded.split('\r\n')) expect(line.length).toBeLessThanOrEqual(76);
    expect(Buffer.from(encoded.replace(/\r\n/g, ''), 'base64').equals(big)).toBe(true);
  });

  it('never puts an attachment url in the message body', () => {
    const built = buildOutbound({
      ...base,
      html: '<p>see <img src="cid:shot@acme"></p>',
      attachments: [
        {
          filename: 'shot.png',
          contentType: 'image/png',
          content: PNG,
          inline: true,
          contentId: 'shot@acme',
        },
      ],
    });
    expect(built.raw).not.toContain('/v1/c/a/');
  });
});
