import { describe, it, expect } from 'vitest';
import { createServer, type Server, type RequestListener } from 'node:http';
import type { LookupAddress } from 'node:dns';
import type { AddressInfo } from 'node:net';
import { MockAgent } from 'undici';
import {
  assertPublicHost,
  isPrivateIp,
  safeFetch,
  SsrfBlockedError,
} from './safe-fetch.ts';

describe('isPrivateIp', () => {
  const cases: Array<[string, boolean]> = [
    ['127.0.0.1', true],
    ['127.10.20.30', true],
    ['0.0.0.0', true],
    ['10.0.0.1', true],
    ['172.16.0.1', true],
    ['172.20.0.1', true],
    ['172.31.255.255', true],
    ['172.32.0.1', false],
    ['192.168.1.1', true],
    ['169.254.169.254', true],
    ['100.64.0.1', true],
    ['198.18.0.1', true],
    ['224.0.0.1', true],
    ['255.255.255.255', true],
    ['1.1.1.1', false],
    ['8.8.8.8', false],
    ['142.250.74.46', false],
    ['::1', true],
    ['fe80::1', true],
    ['fc00::1', true],
    ['fd12:3456::1', true],
    ['::ffff:127.0.0.1', true],
    ['::ffff:8.8.8.8', false],
    ['2002:7f00:0001::', true],
    ['64:ff9b::7f00:1', true],
    ['64:ff9b::a9fe:a9fe', true],
    ['64:ff9b::808:808', false],
    ['64:ff9b:1::808:808', true],
    ['::7f00:1', true],
    ['::127.0.0.1', true],
    ['::8.8.8.8', true],
    ['::ffff:7f00:1', true],
    ['::ffff:a9fe:a9fe', true],
    ['2606:4700:4700::1111', false],
    ['not-an-ip', true],
  ];
  for (const [ip, expected] of cases) {
    it(`${ip} → private=${expected}`, () => {
      expect(isPrivateIp(ip)).toBe(expected);
    });
  }
});

describe('assertPublicHost', () => {
  const publicResolver = (host: string) => {
    if (host === 'public.example') return Promise.resolve([{ address: '93.184.216.34', family: 4 }]);
    if (host === 'mixed.example') {
      return Promise.resolve([
        { address: '93.184.216.34', family: 4 },
        { address: '10.0.0.5', family: 4 },
      ]);
    }
    return Promise.resolve([{ address: '203.0.113.5', family: 4 }]);
  };
  const privateResolver = () => Promise.resolve([{ address: '127.0.0.1', family: 4 }]);

  it('accepts public hostnames', async () => {
    await expect(assertPublicHost('public.example', { resolver: publicResolver })).resolves.toBeUndefined();
  });

  it('rejects literal localhost', async () => {
    await expect(assertPublicHost('localhost', { resolver: publicResolver })).rejects.toThrow(
      SsrfBlockedError,
    );
  });

  it('rejects *.local / *.internal / *.localhost suffixes', async () => {
    await expect(assertPublicHost('printer.local', { resolver: publicResolver })).rejects.toThrow(
      SsrfBlockedError,
    );
    await expect(assertPublicHost('db.internal', { resolver: publicResolver })).rejects.toThrow(
      SsrfBlockedError,
    );
    await expect(assertPublicHost('foo.localhost', { resolver: publicResolver })).rejects.toThrow(
      SsrfBlockedError,
    );
  });

  it('rejects private IP literals', async () => {
    await expect(assertPublicHost('169.254.169.254')).rejects.toThrow(SsrfBlockedError);
    await expect(assertPublicHost('127.0.0.1')).rejects.toThrow(SsrfBlockedError);
    await expect(assertPublicHost('10.5.6.7')).rejects.toThrow(SsrfBlockedError);
  });

  it('judges a bracketed ipv6 url host as the literal it is, not as a name the resolver may vouch for', async () => {
    await expect(
      assertPublicHost('[::ffff:7f00:1]', { resolver: publicResolver }),
    ).rejects.toThrow(/private\/reserved/);
    await expect(assertPublicHost('[2606:4700:4700::1111]')).resolves.toBeUndefined();
  });

  it('rejects hostnames that resolve to mixed public/private addresses', async () => {
    await expect(
      assertPublicHost('mixed.example', { resolver: publicResolver }),
    ).rejects.toThrow(/not reachable as a public address/);
  });

  it('names the host but never the private address it resolved to, so callers cannot map internal dns', async () => {
    const internalResolver = () => Promise.resolve([{ address: '10.20.30.40', family: 4 }]);
    let caught: unknown;
    try {
      await assertPublicHost('postgres', { resolver: internalResolver });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(SsrfBlockedError);
    const blocked = caught as SsrfBlockedError;
    expect(blocked.message).toContain('postgres');
    expect(blocked.message).not.toContain('10.20.30.40');
    expect(blocked.detail).toContain('10.20.30.40');
  });

  it('gives a failed lookup the same message as a private one, so the two are indistinguishable', async () => {
    const failing = () => Promise.reject(new Error('getaddrinfo ENOTFOUND redis'));
    const privateOne = () => Promise.resolve([{ address: '10.0.0.9', family: 4 }]);
    const a = await assertPublicHost('redis', { resolver: failing }).catch((e: Error) => e.message);
    const b = await assertPublicHost('redis', { resolver: privateOne }).catch((e: Error) => e.message);
    expect(a).toBe(b);
  });

  it('rejects hostnames that resolve only to private addresses', async () => {
    await expect(assertPublicHost('bad.example', { resolver: privateResolver })).rejects.toThrow(
      SsrfBlockedError,
    );
  });
});

describe('safeFetch', () => {
  let server: Server;
  let port: number;
  const handler: RequestListener = (_req, res) => {
    res.statusCode = 200;
    res.end('ok');
  };

  function start(): Promise<void> {
    return new Promise((resolve) => {
      server = createServer((req, res) => handler(req, res));
      server.listen(0, '127.0.0.1', () => {
        port = (server.address() as AddressInfo).port;
        resolve();
      });
    });
  }

  function stop(): Promise<void> {
    return new Promise((resolve) => server.close(() => resolve()));
  }

  it('blocks direct fetch to a loopback URL', async () => {
    await start();
    try {
      await expect(safeFetch(`http://127.0.0.1:${port}/`)).rejects.toThrow(SsrfBlockedError);
    } finally {
      await stop();
    }
  });

  it('rejects unsupported protocols', async () => {
    await expect(safeFetch('file:///etc/passwd')).rejects.toThrow(SsrfBlockedError);
  });

  it('respects MUNIN_SSRF_ALLOW_PRIVATE when set', async () => {
    await start();
    process.env.MUNIN_SSRF_ALLOW_PRIVATE = 'true';
    try {
      const res = await safeFetch(`http://127.0.0.1:${port}/`);
      expect(res.status).toBe(200);
      await res.body?.cancel().catch(() => {});
    } finally {
      delete process.env.MUNIN_SSRF_ALLOW_PRIVATE;
      await stop();
    }
  });

  it('returns the array shape undici expects when lookup is called with all:true', async () => {
    await start();
    process.env.MUNIN_SSRF_ALLOW_PRIVATE = 'true';
    const loopbackLookup = (
      _host: string,
      cb: (err: NodeJS.ErrnoException | null, records: LookupAddress[]) => void,
    ) => cb(null, [{ address: '127.0.0.1', family: 4 }]);
    try {
      const res = await safeFetch(`http://public.example:${port}/`, {
        __connectLookup: loopbackLookup,
      });
      expect(res.status).toBe(200);
      await res.body?.cancel().catch(() => {});
    } finally {
      delete process.env.MUNIN_SSRF_ALLOW_PRIVATE;
      await stop();
    }
  });

  it('blocks rebinding: upfront resolver lies "public" but connect-time DNS returns private', async () => {
    await start();
    const lyingResolver = () => Promise.resolve([{ address: '93.184.216.34', family: 4 }]);
    const rebindingLookup = (
      _host: string,
      cb: (err: NodeJS.ErrnoException | null, records: LookupAddress[]) => void,
    ) => cb(null, [{ address: '127.0.0.1', family: 4 }]);
    try {
      let caught: unknown;
      try {
        await safeFetch(`http://public.example:${port}/`, {
          resolver: lyingResolver,
          __connectLookup: rebindingLookup,
        });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeTruthy();
      const causes: string[] = [];
      let walker: unknown = caught;
      while (walker) {
        if (walker instanceof Error) {
          causes.push(walker.message);
          if ((walker as NodeJS.ErrnoException).code) {
            causes.push((walker as NodeJS.ErrnoException).code!);
          }
        }
        walker = (walker as { cause?: unknown } | undefined)?.cause;
      }
      expect(causes.join(' | ')).toMatch(/ESSRF_BLOCKED|private/i);
    } finally {
      await stop();
    }
  });

  function mockUpstream(): MockAgent {
    const agent = new MockAgent();
    agent.disableNetConnect();
    return agent;
  }

  const publicResolver = () => Promise.resolve([{ address: '93.184.216.34', family: 4 }]);

  for (const target of [
    'http://10.0.0.1/secret',
    'http://169.254.169.254/latest/meta-data/',
    'http://[::ffff:7f00:1]/',
    'http://[::ffff:a9fe:a9fe]/',
    'http://localhost/',
  ]) {
    it(`refuses a redirect from a public host to ${target}`, async () => {
      const agent = mockUpstream();
      agent
        .get('https://public.example')
        .intercept({ path: '/start' })
        .reply(302, '', { headers: { location: target } });
      await expect(
        safeFetch('https://public.example/start', { resolver: publicResolver, __dispatcher: agent }),
      ).rejects.toBeInstanceOf(SsrfBlockedError);
    });
  }

  it('reports the url it finally landed on after following a redirect', async () => {
    const agent = mockUpstream();
    const pool = agent.get('https://public.example');
    pool.intercept({ path: '/old' }).reply(301, '', { headers: { location: '/new/page' } });
    pool.intercept({ path: '/new/page' }).reply(200, 'landed');
    const res = await safeFetch('https://public.example/old', {
      resolver: publicResolver,
      __dispatcher: agent,
    });
    expect(res.url).toBe('https://public.example/new/page');
    expect(await res.text()).toBe('landed');
  });

  it('keeps the private address out of the connect-time error it raises on rebinding', async () => {
    await start();
    const rebindingLookup = (
      _host: string,
      cb: (err: NodeJS.ErrnoException | null, records: LookupAddress[]) => void,
    ) => cb(null, [{ address: '127.0.0.1', family: 4 }]);
    try {
      const caught = await safeFetch(`http://public.example:${port}/`, {
        resolver: publicResolver,
        __connectLookup: rebindingLookup,
      }).catch((err: unknown) => err);
      const messages: string[] = [];
      let walker: unknown = caught;
      while (walker instanceof Error) {
        messages.push(walker.message);
        walker = walker.cause;
      }
      expect(messages.join(' | ')).not.toContain('127.0.0.1');
    } finally {
      await stop();
    }
  });

  it('streams response bodies larger than the initial socket buffer to completion', async () => {
    const payload = Buffer.alloc(2 * 1024 * 1024, 0x61);
    const streamingHandler: RequestListener = (_req, res) => {
      res.statusCode = 200;
      res.setHeader('content-type', 'application/octet-stream');
      const half = payload.subarray(0, payload.length / 2);
      res.write(half);
      setTimeout(() => {
        res.write(payload.subarray(payload.length / 2));
        res.end();
      }, 50);
    };
    const server = createServer(streamingHandler);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const localPort = (server.address() as AddressInfo).port;
    process.env.MUNIN_SSRF_ALLOW_PRIVATE = 'true';
    try {
      const res = await safeFetch(`http://127.0.0.1:${localPort}/big`);
      expect(res.status).toBe(200);
      const buf = Buffer.from(await res.arrayBuffer());
      expect(buf.length).toBe(payload.length);
      expect(buf.equals(payload)).toBe(true);
    } finally {
      delete process.env.MUNIN_SSRF_ALLOW_PRIVATE;
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
