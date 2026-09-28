import { describe, expect, it } from 'vitest';
import { contentMatchesMime } from './org-logo.service.ts';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]);
const SVG = Buffer.from('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"></svg>');

describe('contentMatchesMime', () => {
  it('accepts each supported format when its bytes match the declared type', () => {
    expect(contentMatchesMime('image/png', PNG)).toBe(true);
    expect(contentMatchesMime('image/jpeg', JPEG)).toBe(true);
    expect(contentMatchesMime('image/webp', WEBP)).toBe(true);
    expect(contentMatchesMime('image/svg+xml', SVG)).toBe(true);
  });

  it('rejects bytes that belong to a different format than the declared type', () => {
    expect(contentMatchesMime('image/png', JPEG)).toBe(false);
    expect(contentMatchesMime('image/jpeg', PNG)).toBe(false);
    expect(contentMatchesMime('image/webp', PNG)).toBe(false);
    expect(contentMatchesMime('image/svg+xml', PNG)).toBe(false);
  });

  it('rejects svg-typed uploads that contain no svg element', () => {
    expect(contentMatchesMime('image/svg+xml', Buffer.from('<html><body>hi</body></html>'))).toBe(false);
    expect(contentMatchesMime('image/svg+xml', Buffer.from('<svgfoo/>'))).toBe(false);
  });

  it('rejects types outside the logo allow-list', () => {
    expect(contentMatchesMime('image/gif', Buffer.from('GIF89a'))).toBe(false);
  });
});
