import { describe, it, expect } from 'vitest';
import { extractDataUriImages, htmlHasDataUriImage } from './inline-data-uri.ts';
import {
  CONV_ATTACHMENT_INBOUND_BYTES_MIN,
  CONV_ATTACHMENT_PER_MESSAGE_MAX,
} from './conv-attachments.constants.ts';

function dataUri(mime: string, bytes: number): string {
  return `data:${mime};base64,${Buffer.alloc(bytes, 7).toString('base64')}`;
}

const BIG = CONV_ATTACHMENT_INBOUND_BYTES_MIN + 1024;

describe('extractDataUriImages', () => {
  it('replaces an inlined image with a cid reference and hands back the bytes', () => {
    const html = `<p>see</p><img src="${dataUri('image/png', BIG)}" alt="x">`;
    const result = extractDataUriImages(html, 'cvm_1');

    expect(result.images).toHaveLength(1);
    expect(result.images[0]!.mime).toBe('image/png');
    expect(result.images[0]!.body.length).toBe(BIG);
    expect(result.images[0]!.name).toBe('inline-1.png');
    expect(result.html).toContain(`cid:${result.images[0]!.contentId}`);
    expect(result.html).not.toContain('base64');
  });

  it('leaves a tracking-pixel-sized image inlined rather than promoting it to an attachment', () => {
    const html = `<img src="${dataUri('image/gif', 40)}">`;
    const result = extractDataUriImages(html, 'cvm_1');

    expect(result.images).toHaveLength(0);
    expect(result.skipped).toBe(1);
    expect(result.html).toBe(html);
  });

  it('leaves a disallowed type alone, so an svg payload is never promoted', () => {
    const html = `<img src="${dataUri('image/svg+xml', BIG)}">`;
    const result = extractDataUriImages(html, 'cvm_1');

    expect(result.images).toHaveLength(0);
    expect(result.skipped).toBe(1);
    expect(result.html).toBe(html);
  });

  it('stops at the per-message cap and leaves the remainder inlined', () => {
    const one = `<img src="${dataUri('image/png', BIG)}">`;
    const html = one.repeat(CONV_ATTACHMENT_PER_MESSAGE_MAX + 3);
    const result = extractDataUriImages(html, 'cvm_1');

    expect(result.images).toHaveLength(CONV_ATTACHMENT_PER_MESSAGE_MAX);
    expect(result.skipped).toBe(3);
    expect(result.html).toContain('base64');
  });

  it('gives every extracted image a distinct content id', () => {
    const html = `<img src="${dataUri('image/png', BIG)}"><img src="${dataUri('image/jpeg', BIG)}">`;
    const result = extractDataUriImages(html, 'cvm_1');

    expect(result.images).toHaveLength(2);
    expect(new Set(result.images.map((i) => i.contentId)).size).toBe(2);
    for (const img of result.images) expect(result.html).toContain(`cid:${img.contentId}`);
  });

  it('is a no-op on html with no inlined images', () => {
    const html = '<p>hello <img src="https://example.com/a.png"></p>';
    const result = extractDataUriImages(html, 'cvm_1');
    expect(result.images).toHaveLength(0);
    expect(result.html).toBe(html);
  });

  it('detects inlined images without extracting, and the detector is not sticky across calls', () => {
    const html = `<img src="${dataUri('image/png', BIG)}">`;
    expect(htmlHasDataUriImage(html)).toBe(true);
    expect(htmlHasDataUriImage(html)).toBe(true);
    expect(htmlHasDataUriImage('<p>no</p>')).toBe(false);
    expect(htmlHasDataUriImage(null)).toBe(false);
  });
});
