import { describe, it, expect, afterEach, vi } from 'vitest';
import sharp from 'sharp';
import {
  SocialMediaError,
  extractOpenGraph,
  fetchMedia,
  mediaKindFor,
  transcodeImage,
  transcodesToImage,
} from './social-media.ts';

const LIMITS = {
  maxImageBytes: 1024,
  maxVideoBytes: 4096,
  imageContentTypes: ['image/jpeg', 'image/png'],
  videoContentTypes: ['video/mp4'],
};

const BIG_LIMITS = { ...LIMITS, maxImageBytes: 5 * 1024 * 1024 };

function solidImage(format: 'webp' | 'avif' | 'png', alpha: number): Promise<Buffer> {
  const canvas = sharp({
    create: { width: 48, height: 32, channels: 4, background: { r: 10, g: 80, b: 160, alpha } },
  });
  if (format === 'webp') return canvas.webp().toBuffer();
  if (format === 'avif') return canvas.avif().toBuffer();
  return canvas.png().toBuffer();
}

describe('extractOpenGraph', () => {
  it('reads the card a page advertises and resolves a relative image against the page', () => {
    const html = `
      <html><head>
        <meta property="og:title" content="A post about &amp; things">
        <meta property="og:description" content='Short "summary"'>
        <meta property="og:image" content="/img/card.png">
      </head></html>`;
    expect(extractOpenGraph(html, 'https://example.com/blog/a')).toEqual({
      title: 'A post about & things',
      description: 'Short "summary"',
      imageUrl: 'https://example.com/img/card.png',
    });
  });

  it('prefers the first value for a key so a later duplicate cannot override it', () => {
    const html = `
      <meta property="og:image" content="https://example.com/first.png">
      <meta property="og:image" content="https://example.com/second.png">`;
    expect(extractOpenGraph(html, 'https://example.com').imageUrl).toBe(
      'https://example.com/first.png',
    );
  });

  it('falls back to twitter tags, and to nothing at all when a page advertises none', () => {
    expect(
      extractOpenGraph('<meta name="twitter:image" content="https://example.com/t.png">', 'https://example.com')
        .imageUrl,
    ).toBe('https://example.com/t.png');
    expect(extractOpenGraph('<html><body>no meta here</body></html>', 'https://example.com')).toEqual(
      { title: null, description: null, imageUrl: null },
    );
  });

  it('drops an image url that is not http, which would otherwise be fetched as a data or file uri', () => {
    const html = '<meta property="og:image" content="data:image/png;base64,AAAA">';
    expect(extractOpenGraph(html, 'https://example.com').imageUrl).toBeNull();
  });

  it('scans a long attribute-heavy page in linear time rather than backtracking', () => {
    const noise = '<meta name="x" content="y" data-a="1" data-b="2">'.repeat(4000);
    const started = Date.now();
    const result = extractOpenGraph(
      `${noise}<meta property="og:image" content="https://example.com/c.png">`,
      'https://example.com',
    );
    expect(result.imageUrl).toBe('https://example.com/c.png');
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe('mediaKindFor', () => {
  it('maps a content type to the kind, ignoring charset parameters', () => {
    expect(mediaKindFor('image/png; charset=binary', LIMITS)).toBe('image');
    expect(mediaKindFor('VIDEO/MP4', LIMITS)).toBe('video');
    expect(mediaKindFor('application/pdf', LIMITS)).toBeNull();
  });
});

describe('transcodesToImage', () => {
  it('claims a decodable type the platform will not take, and leaves every other type alone', () => {
    expect(transcodesToImage('image/webp', LIMITS)).toBe(true);
    expect(transcodesToImage('IMAGE/AVIF; charset=binary', LIMITS)).toBe(true);
    expect(transcodesToImage('image/png', LIMITS)).toBe(false);
    expect(transcodesToImage('image/svg+xml', LIMITS)).toBe(false);
    expect(transcodesToImage('video/mp4', LIMITS)).toBe(false);
  });

  it('leaves a type alone when the platform already accepts it', () => {
    expect(transcodesToImage('image/webp', { imageContentTypes: ['image/webp'] })).toBe(false);
  });

  it('declines when the platform takes neither jpeg nor png to convert into', () => {
    expect(transcodesToImage('image/webp', { imageContentTypes: ['image/gif'] })).toBe(false);
  });
});

describe('transcodeImage', () => {
  it('converts an opaque source to jpeg', async () => {
    const converted = await transcodeImage(await solidImage('webp', 1), {
      sourceType: 'image/webp',
      imageContentTypes: LIMITS.imageContentTypes,
    });
    expect(converted.contentType).toBe('image/jpeg');
    expect((await sharp(converted.bytes).metadata()).format).toBe('jpeg');
  });

  it('keeps a transparent source lossless as png rather than flattening it into jpeg', async () => {
    const converted = await transcodeImage(await solidImage('webp', 0.4), {
      sourceType: 'image/webp',
      imageContentTypes: LIMITS.imageContentTypes,
    });
    expect(converted.contentType).toBe('image/png');
    expect((await sharp(converted.bytes).metadata()).hasAlpha).toBe(true);
  });

  it('falls back to png when the platform does not take jpeg', async () => {
    const converted = await transcodeImage(await solidImage('webp', 1), {
      sourceType: 'image/webp',
      imageContentTypes: ['image/png'],
    });
    expect(converted.contentType).toBe('image/png');
  });

  it('reports a source it cannot decode instead of uploading garbage', async () => {
    await expect(
      transcodeImage(Buffer.from('not an image at all'), {
        sourceType: 'image/webp',
        imageContentTypes: LIMITS.imageContentTypes,
      }),
    ).rejects.toBeInstanceOf(SocialMediaError);
  });
});

describe('fetchMedia', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stub(response: Response) {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(response)));
  }

  function body(bytes: Buffer, headers: Record<string, string>) {
    return new Response(new Uint8Array(bytes), { status: 200, headers });
  }

  it('returns the bytes with the kind the content type implies', async () => {
    stub(body(Buffer.from('png'), { 'content-type': 'image/png' }));
    const media = await fetchMedia('https://example.com/a.png', { limits: LIMITS });
    expect(media.kind).toBe('image');
    expect(media.bytes.toString()).toBe('png');
  });

  it('refuses a type the platform does not take', async () => {
    stub(body(Buffer.from('%PDF'), { 'content-type': 'application/pdf' }));
    await expect(fetchMedia('https://example.com/a.pdf', { limits: LIMITS })).rejects.toBeInstanceOf(
      SocialMediaError,
    );
  });

  it('converts a webp card image the platform would otherwise reject, rather than dropping it', async () => {
    stub(body(await solidImage('webp', 1), { 'content-type': 'image/webp' }));
    const media = await fetchMedia('https://example.com/card.webp', { limits: BIG_LIMITS });
    expect(media.kind).toBe('image');
    expect(media.contentType).toBe('image/jpeg');
    expect(BIG_LIMITS.imageContentTypes).toContain(media.contentType);
  });

  it('converts avif too, and an opaque alpha channel still goes to jpeg, not an oversized png', async () => {
    const source = await solidImage('avif', 1);
    expect((await sharp(source).metadata()).hasAlpha).toBe(true);
    stub(body(source, { 'content-type': 'image/avif' }));
    const media = await fetchMedia('https://example.com/card.avif', { limits: BIG_LIMITS });
    expect(media.contentType).toBe('image/jpeg');
  });

  it('counts a converted image as the image the draft expected', async () => {
    stub(body(await solidImage('webp', 1), { 'content-type': 'image/webp' }));
    const media = await fetchMedia('https://example.com/card.webp', {
      expectedKind: 'image',
      limits: BIG_LIMITS,
    });
    expect(media.kind).toBe('image');
  });

  it('refuses a converted image that came out over the cap instead of letting the platform reject it', async () => {
    stub(body(await solidImage('webp', 1), { 'content-type': 'image/webp' }));
    await expect(
      fetchMedia('https://example.com/card.webp', { limits: { ...LIMITS, maxImageBytes: 200 } }),
    ).rejects.toThrow(/over the/);
  });

  it('refuses a file that is not the kind the draft declared', async () => {
    stub(body(Buffer.from('mp4'), { 'content-type': 'video/mp4' }));
    await expect(
      fetchMedia('https://example.com/a.mp4', { expectedKind: 'image', limits: LIMITS }),
    ).rejects.toThrow(/is a video, not a image/);
  });

  it('refuses a body over the per-kind cap even when the server declares no length', async () => {
    stub(body(Buffer.alloc(2048), { 'content-type': 'image/png' }));
    await expect(fetchMedia('https://example.com/big.png', { limits: LIMITS })).rejects.toThrow(
      /limit/,
    );
  });

  it('refuses a non-public host before any request goes out', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchMedia('http://127.0.0.1/a.png', { limits: LIMITS })).rejects.toThrow(
      /not a public address/,
    );
    await expect(fetchMedia('http://[::1]/a.png', { limits: LIMITS })).rejects.toThrow(
      /not a public address/,
    );
    await expect(fetchMedia('http://169.254.169.254/latest', { limits: LIMITS })).rejects.toThrow(
      /not a public address/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('re-checks the host on every redirect hop, not only the one it was handed', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response('', { status: 302, headers: { location: 'http://10.0.0.1/secret' } }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchMedia('https://example.com/a.png', { limits: LIMITS })).rejects.toThrow(
      /not a public address/,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
