import { describe, expect, it } from 'vitest';
import {
  FAVICON_MAX_BYTES,
  fetchImage,
  ICON_RESPONSE_HEADERS,
  readCappedBody,
  sendIcon,
  type IconFetcher,
  type IconResponse,
} from './oauth-client-info.controller.ts';

function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      const next = chunks[i++];
      if (next) controller.enqueue(next);
      else controller.close();
    },
  });
}

function fetcherReturning(
  contentType: string,
  chunks: Uint8Array[],
  extraHeaders: Record<string, string> = {},
  ok = true,
): IconFetcher {
  return () => {
    const headers = new Headers({ 'content-type': contentType, ...extraHeaders });
    return Promise.resolve({ ok, headers, body: streamOf(chunks) });
  };
}

class RecordingResponse implements IconResponse {
  statusCode = 0;
  headers = new Map<string, string>();
  body: Buffer | null = null;
  status(code: number): IconResponse {
    this.statusCode = code;
    return this;
  }
  setHeader(name: string, value: string): IconResponse {
    this.headers.set(name.toLowerCase(), value);
    return this;
  }
  send(body: Buffer): unknown {
    this.body = body;
    return this;
  }
}

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('fetchImage', () => {
  it('never proxies an upstream svg, since it would execute script on the api origin', async () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    const icon = await fetchImage('https://icons.example/x.svg', fetcherReturning('image/svg+xml', [svg]));
    expect(icon).toBeNull();
  });

  it('rejects a non-image upstream content type', async () => {
    const html = new TextEncoder().encode('<html></html>');
    expect(
      await fetchImage('https://icons.example/x', fetcherReturning('text/html; charset=utf-8', [html])),
    ).toBeNull();
  });

  it('accepts an allow-listed raster image and normalises its mime', async () => {
    const icon = await fetchImage(
      'https://icons.example/x.png',
      fetcherReturning('IMAGE/PNG; charset=binary', [PNG_BYTES]),
    );
    expect(icon?.mime).toBe('image/png');
    expect(icon?.body.equals(Buffer.from(PNG_BYTES))).toBe(true);
  });

  it('gives up once a streamed body passes the byte cap instead of buffering it whole', async () => {
    const chunk = new Uint8Array(64 * 1024);
    const chunks = Array.from({ length: FAVICON_MAX_BYTES / chunk.byteLength + 2 }, () => chunk);
    expect(await fetchImage('https://icons.example/big.png', fetcherReturning('image/png', chunks))).toBeNull();
  });

  it('refuses a declared content-length over the cap without reading the body', async () => {
    let pulled = false;
    const fetcher: IconFetcher = () =>
      Promise.resolve({
        ok: true,
        headers: new Headers({
          'content-type': 'image/png',
          'content-length': String(FAVICON_MAX_BYTES + 1),
        }),
        body: new ReadableStream<Uint8Array>(
          {
            pull(controller) {
              pulled = true;
              controller.close();
            },
          },
          { highWaterMark: 0 },
        ),
      });
    expect(await fetchImage('https://icons.example/big.png', fetcher)).toBeNull();
    expect(pulled).toBe(false);
  });

  it('returns null for a non-ok upstream', async () => {
    expect(
      await fetchImage('https://icons.example/x.png', fetcherReturning('image/png', [PNG_BYTES], {}, false)),
    ).toBeNull();
  });

  it('returns null when the fetch itself throws', async () => {
    const fetcher: IconFetcher = () => Promise.reject(new Error('connection refused'));
    expect(await fetchImage('https://icons.example/x.png', fetcher)).toBeNull();
  });
});

describe('readCappedBody', () => {
  it('returns the concatenated bytes when the stream stays within the cap', async () => {
    const out = await readCappedBody(streamOf([new Uint8Array([1, 2]), new Uint8Array([3])]), 3);
    expect(out && [...out]).toEqual([1, 2, 3]);
  });

  it('returns null as soon as the stream exceeds the cap', async () => {
    expect(await readCappedBody(streamOf([new Uint8Array([1, 2]), new Uint8Array([3])]), 2)).toBeNull();
  });

  it('returns null for a missing body', async () => {
    expect(await readCappedBody(null, 10)).toBeNull();
  });
});

describe('sendIcon', () => {
  it('sandboxes a fetched icon with csp, nosniff and an inline disposition', () => {
    const res = new RecordingResponse();
    sendIcon(res, { body: Buffer.from(PNG_BYTES), mime: 'image/png' });
    expect(res.statusCode).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    for (const [name, value] of Object.entries(ICON_RESPONSE_HEADERS)) {
      expect(res.headers.get(name)).toBe(value);
    }
    expect(res.headers.get('content-security-policy')).toContain('sandbox');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('applies the same sandbox headers to the built-in fallback svg', () => {
    const res = new RecordingResponse();
    sendIcon(res, null);
    expect(res.headers.get('content-type')).toBe('image/svg+xml');
    expect(res.headers.get('content-security-policy')).toBe(
      ICON_RESPONSE_HEADERS['content-security-policy'],
    );
    expect(res.headers.get('content-disposition')).toBe('inline; filename="icon"');
    expect(res.body?.toString('utf8')).toContain('<svg');
  });
});
