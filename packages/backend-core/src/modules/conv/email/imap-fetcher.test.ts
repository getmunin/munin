import 'reflect-metadata';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type AddressInfo, type Socket } from 'node:net';
import { ImapFlowFetcher } from './email-adapter.ts';

interface FakeImap {
  port: number;
  bodyFetches: () => number;
  close: () => void;
}

function fakeImapServer(message: { declaredSize: number; literalSize: number }): Promise<FakeImap> {
  let bodyFetches = 0;
  const sockets: Socket[] = [];
  const server = createServer((sock) => {
    sockets.push(sock);
    sock.on('error', () => undefined);
    sock.write('* OK [CAPABILITY IMAP4rev1 AUTH=PLAIN] ready\r\n');
    let pending = '';
    sock.on('data', (data) => {
      pending += data.toString('latin1');
      for (let end = pending.indexOf('\r\n'); end >= 0; end = pending.indexOf('\r\n')) {
        const line = pending.slice(0, end);
        pending = pending.slice(end + 2);
        const [tag, command = '', ...rest] = line.split(' ');
        const verb = command.toUpperCase();
        const args = rest.join(' ').toUpperCase();
        if (verb === 'SELECT' || verb === 'EXAMINE') {
          sock.write('* 1 EXISTS\r\n* OK [UIDVALIDITY 7] ok\r\n* OK [UIDNEXT 2] ok\r\n');
          sock.write(`${tag} OK [READ-WRITE] done\r\n`);
        } else if (verb === 'UID' && args.startsWith('FETCH') && args.includes('RFC822.SIZE')) {
          sock.write(`* 1 FETCH (UID 1 RFC822.SIZE ${message.declaredSize})\r\n`);
          sock.write(`${tag} OK done\r\n`);
        } else if (verb === 'UID' && args.startsWith('FETCH')) {
          bodyFetches += 1;
          sock.write(`* 1 FETCH (UID 1 BODY[] {${message.literalSize}}\r\n`);
          const chunk = Buffer.alloc(64 * 1024, 0x78);
          const pump = (): void => {
            if (sock.destroyed) return;
            if (sock.write(chunk)) setImmediate(pump);
            else sock.once('drain', pump);
          };
          pump();
        } else if (verb === 'LOGOUT') {
          sock.write(`* BYE\r\n${tag} OK done\r\n`);
          sock.end();
        } else {
          sock.write(`${tag} OK done\r\n`);
        }
      }
    });
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve({
        port: (server.address() as AddressInfo).port,
        bodyFetches: () => bodyFetches,
        close: () => {
          for (const sock of sockets) sock.destroy();
          server.close();
        },
      }),
    ),
  );
}

describe('ImapFlowFetcher size limits', () => {
  let server: FakeImap | null = null;

  beforeEach(() => {
    process.env.MUNIN_SSRF_ALLOW_PRIVATE = 'true';
  });

  afterEach(() => {
    delete process.env.MUNIN_SSRF_ALLOW_PRIVATE;
    server?.close();
    server = null;
  });

  function connect(port: number) {
    return {
      host: '127.0.0.1',
      port,
      secure: false,
      username: 'support@acme.test',
      password: 'placeholder',
      mailbox: 'INBOX',
      sinceUid: 0,
      uidValidity: null,
      limit: 100,
    };
  }

  it('reports a message the server declares as oversized without ever asking for its body', async () => {
    server = await fakeImapServer({ declaredSize: 900 * 1024 * 1024, literalSize: 0 });
    const result = await new ImapFlowFetcher().fetchSince(connect(server.port));
    expect(result.messages).toEqual([]);
    expect(result.oversized).toEqual([{ uid: 1, size: 900 * 1024 * 1024 }]);
    expect(server.bodyFetches()).toBe(0);
  });

  it('fails the poll instead of buffering a body far larger than the size the server declared', async () => {
    server = await fakeImapServer({ declaredSize: 2_000, literalSize: 1024 * 1024 * 1024 });
    const started = Date.now();
    await expect(new ImapFlowFetcher().fetchSince(connect(server.port))).rejects.toThrow();
    expect(server.bodyFetches()).toBe(1);
    expect(Date.now() - started).toBeLessThan(10_000);
  });
});
