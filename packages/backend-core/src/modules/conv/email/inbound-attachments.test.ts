import { describe, expect, it } from 'vitest';
import {
  CONV_ATTACHMENT_INBOUND_BYTES_MIN,
  CONV_ATTACHMENT_PER_MESSAGE_MAX,
} from '../attachments/conv-attachments.constants.ts';
import {
  collectCidReferences,
  filterInboundAttachments,
  inboundAttachmentName,
  normalizeCid,
  normalizeCidReferences,
  type InboundEmailAttachment,
} from './inbound-attachments.ts';

const BIG = CONV_ATTACHMENT_INBOUND_BYTES_MIN * 3;

function part(overrides: Partial<InboundEmailAttachment> = {}): InboundEmailAttachment {
  return {
    content: Buffer.alloc(BIG, 1),
    contentType: 'image/png',
    filename: 'photo.png',
    cid: null,
    contentDisposition: 'attachment',
    related: false,
    ...overrides,
  };
}

const probe640 = () => Promise.resolve({ width: 640, height: 480 });

describe('collectCidReferences / normalizeCid', () => {
  it('finds cids in src attributes, background urls and percent-encoded refs', () => {
    const html =
      '<img src="cid:Logo@Mail"><div style="background:url(cid:hero.jpg)"></div>' +
      "<img src='cid:pct%40host'>";
    const refs = collectCidReferences(html);
    expect([...refs].sort()).toEqual(['hero.jpg', 'logo@mail', 'pct@host']);
  });

  it('strips angle brackets and lowercases a Content-ID header value', () => {
    expect(normalizeCid('<Abc@Host>')).toBe('abc@host');
    expect(normalizeCid('   ')).toBeNull();
    expect(normalizeCid(null)).toBeNull();
  });
});

describe('filterInboundAttachments', () => {
  it('keeps a real photo and drops a tracking pixel by size', async () => {
    const result = await filterInboundAttachments(
      [
        part({ filename: 'holiday.jpg', contentType: 'image/jpeg' }),
        part({ filename: 'open.gif', contentType: 'image/gif', content: Buffer.alloc(43, 0) }),
      ],
      { html: '<p>hi</p>', probe: probe640 },
    );
    expect(result.kept.map((k) => k.name)).toEqual(['holiday.jpg']);
    expect(result.dropped).toEqual([
      { name: 'open.gif', mime: 'image/gif', sizeBytes: 43, reason: 'too_small' },
    ]);
  });

  it('drops an inline part whose cid the stripped html no longer references', async () => {
    const result = await filterInboundAttachments(
      [
        part({ filename: 'logo.png', cid: 'sig-logo@corp', contentDisposition: 'inline', related: true }),
        part({ filename: 'screenshot.png', cid: 'shot@corp', contentDisposition: 'inline', related: true }),
      ],
      { html: '<p>see</p><img src="cid:shot@corp">', probe: probe640 },
    );
    expect(result.kept.map((k) => k.name)).toEqual(['screenshot.png']);
    expect(result.kept[0]!.inline).toBe(true);
    expect(result.kept[0]!.contentId).toBe('shot@corp');
    expect(result.dropped[0]).toMatchObject({ name: 'logo.png', reason: 'unreferenced_cid' });
  });

  it('keeps an inline part when the message has no html body to reference it from', async () => {
    const result = await filterInboundAttachments(
      [part({ filename: 'pasted.png', cid: 'x@y', contentDisposition: 'inline', related: true })],
      { html: null, probe: probe640 },
    );
    expect(result.kept).toHaveLength(1);
    expect(result.kept[0]!.inline).toBe(false);
    expect(result.kept[0]!.contentId).toBeNull();
  });

  it('drops anything outside the mime allowlist, svg included', async () => {
    const result = await filterInboundAttachments(
      [
        part({ filename: 'invoice.pdf', contentType: 'application/pdf' }),
        part({ filename: 'icon.svg', contentType: 'image/svg+xml' }),
        part({ filename: 'note.txt', contentType: 'text/plain; charset=utf-8' }),
      ],
      { html: '<p>hi</p>', probe: probe640 },
    );
    expect(result.kept).toHaveLength(0);
    expect(result.dropped.map((d) => d.reason)).toEqual([
      'mime_rejected',
      'mime_rejected',
      'mime_rejected',
    ]);
  });

  it('drops an image whose short edge is under the floor even when its byte size passes', async () => {
    const result = await filterInboundAttachments([part({ filename: 'rule.png' })], {
      html: '<p>hi</p>',
      probe: () => Promise.resolve({ width: 600, height: 8 }),
    });
    expect(result.kept).toHaveLength(0);
    expect(result.dropped[0]).toMatchObject({ reason: 'edge_too_small' });
  });

  it('drops a part sharp cannot decode', async () => {
    const result = await filterInboundAttachments([part({ filename: 'broken.png' })], {
      html: '<p>hi</p>',
      probe: () => Promise.resolve(null),
    });
    expect(result.dropped[0]).toMatchObject({ reason: 'undecodable' });
  });

  it('keeps at most CONV_ATTACHMENT_PER_MESSAGE_MAX and reports the overflow', async () => {
    const parts = Array.from({ length: CONV_ATTACHMENT_PER_MESSAGE_MAX + 3 }, (_, i) =>
      part({ filename: `p${i}.png` }),
    );
    const result = await filterInboundAttachments(parts, { html: '<p>hi</p>', probe: probe640 });
    expect(result.kept).toHaveLength(CONV_ATTACHMENT_PER_MESSAGE_MAX);
    expect(result.dropped).toHaveLength(3);
    expect(result.dropped.every((d) => d.reason === 'per_message_max')).toBe(true);
  });
});

describe('inboundAttachmentName', () => {
  it('forces the extension to match the mime so a png named .svg cannot smuggle past the store', () => {
    expect(inboundAttachmentName({ filename: 'payload.svg', contentType: 'image/png' }, 0)).toBe(
      'payload.png',
    );
  });

  it('strips path segments, quotes and control characters, and names an unnamed part', () => {
    expect(
      inboundAttachmentName({ filename: '../../etc/pa"ss.jpeg', contentType: 'image/jpeg' }, 0),
    ).toBe('pass.jpg');
    expect(inboundAttachmentName({ filename: null, contentType: 'image/webp' }, 2)).toBe(
      'image-3.webp',
    );
  });
});

describe('normalizeCidReferences', () => {
  it('keeps a surviving cid reference and removes images whose part was dropped', () => {
    const html =
      '<p>hi</p><img src="cid:shot@corp" alt="a"><img src="cid:sig-logo@corp" width="88">';
    const out = normalizeCidReferences(html, new Set(['shot@corp']));
    expect(out).toBe('<p>hi</p><img src="cid:shot@corp" alt="a">');
  });

  it('writes nothing time-limited into the stored html', () => {
    const out = normalizeCidReferences(
      '<img src="cid:shot@corp">',
      new Set(['shot@corp']),
    );
    expect(out).not.toContain('/v1/c/a/');
    expect(out).not.toMatch(/https?:/);
  });

  it('lowercases and unbrackets a reference so it matches the stored contentId exactly', () => {
    expect(normalizeCidReferences('<img src="cid:Shot%40Corp">', new Set(['shot@corp']))).toBe(
      '<img src="cid:shot@corp">',
    );
  });

  it('is a no-op on a null body and leaves non-cid markup alone', () => {
    expect(normalizeCidReferences(null, new Set())).toBeNull();
    expect(normalizeCidReferences('<img src="https://x.test/a.png">', new Set())).toBe(
      '<img src="https://x.test/a.png">',
    );
  });
});
