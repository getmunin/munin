import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
  Optional,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { WebSocketServer, type WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import type { Db } from '@getmunin/db';
import { CredentialResolver, type ResolvedCredential } from '@getmunin/core';
import { DB } from '../common/db/db.module.js';
import {
  ADDITIONAL_CREDENTIAL_RESOLVERS,
  type AdditionalCredentialResolver,
} from '../common/auth/auth.guard.js';
import { DbListenerService, type EventRow } from './db-listener.service.js';

const PATH = '/api/realtime';

interface ClientMessage {
  type: 'subscribe' | 'unsubscribe' | 'ping';
  channel?: 'org' | 'conversation' | 'contact';
  id?: string;
}

@Injectable()
export class RealtimeGateway implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(RealtimeGateway.name);
  private wss: WebSocketServer | null = null;
  private upgradeListener: ((req: IncomingMessage, socket: Duplex, head: Buffer) => void) | null =
    null;
  private readonly resolver: CredentialResolver;

  constructor(
    private readonly adapterHost: HttpAdapterHost,
    private readonly listener: DbListenerService,
    @Inject(DB) db: Db,
    @Optional()
    @Inject(ADDITIONAL_CREDENTIAL_RESOLVERS)
    private readonly additionalResolvers: AdditionalCredentialResolver[] = [],
  ) {
    this.resolver = new CredentialResolver(db);
  }

  onApplicationBootstrap(): void {
    if (process.env.MUNIN_REALTIME_DISABLED === '1') {
      this.logger.log('realtime gateway disabled via MUNIN_REALTIME_DISABLED');
      return;
    }
    const httpServer = this.adapterHost.httpAdapter.getHttpServer() as
      | { on(event: string, listener: (...args: unknown[]) => void): void }
      | null;
    if (!httpServer) {
      this.logger.warn('http server not available; realtime gateway inactive');
      return;
    }

    this.wss = new WebSocketServer({
      noServer: true,
      // Browsers can't set arbitrary HTTP headers on a WebSocket upgrade, so
      // browser callers pass the bearer token via Sec-WebSocket-Protocol:
      //   ['bearer', '<token>']  →  send 'bearer' back so the handshake
      // completes. Native (Node ws) callers set the Authorization header and
      // don't offer any subprotocol, so we just decline negotiation.
      handleProtocols: (protocols) => {
        if (protocols.has('bearer')) return 'bearer';
        return false;
      },
    });
    const listener = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      if (!req.url || !req.url.startsWith(PATH)) return;
      void this.handleUpgrade(req, socket, head);
    };
    this.upgradeListener = listener;
    (httpServer as unknown as { on: (e: string, l: typeof listener) => void }).on(
      'upgrade',
      listener,
    );
    this.logger.log(`gateway listening on ${PATH}`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.wss) {
      this.wss.clients.forEach((c) => c.terminate());
      await new Promise<void>((resolve) =>
        this.wss!.close(() => resolve()),
      );
      this.wss = null;
    }
  }

  private async handleUpgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): Promise<void> {
    let credential: ResolvedCredential | null = null;
    try {
      credential = await this.authenticate(req);
    } catch (err) {
      this.logger.debug(`upgrade auth failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!credential) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    if (!this.wss) {
      socket.destroy();
      return;
    }
    const resolvedCredential = credential;
    this.wss.handleUpgrade(req, socket, head, (ws) => {
      this.handleConnection(ws, resolvedCredential);
    });
  }

  private handleConnection(ws: WebSocket, credential: ResolvedCredential): void {
    const actor = credential.actor;
    const subscriptions = new Set<string>();

    const unsubscribe = this.listener.subscribe((event) => {
      if (event.org_id !== actor.orgId) return;
      if (
        actor.type === 'end_user_agent' &&
        actor.endUserId &&
        !ownsEvent(event, actor.endUserId)
      ) {
        return;
      }
      for (const channel of subscriptions) {
        if (channelMatches(channel, event)) {
          ws.send(JSON.stringify({ type: 'event', channel, event }));
        }
      }
    });

    ws.on('message', (data) => {
      let msg: ClientMessage | null = null;
      try {
        const text = Buffer.isBuffer(data)
          ? data.toString('utf8')
          : Array.isArray(data)
            ? Buffer.concat(data).toString('utf8')
            : Buffer.from(data).toString('utf8');
        msg = JSON.parse(text) as ClientMessage;
      } catch {
        return;
      }
      if (msg.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
        return;
      }
      const key = encodeChannel(msg);
      if (!key) return;
      if (msg.type === 'subscribe') subscriptions.add(key);
      else if (msg.type === 'unsubscribe') subscriptions.delete(key);
    });

    ws.on('close', () => {
      unsubscribe();
    });
    ws.on('error', () => {
      unsubscribe();
    });

    ws.send(JSON.stringify({ type: 'ready', orgId: actor.orgId }));
  }

  private async authenticate(req: IncomingMessage): Promise<ResolvedCredential | null> {
    const headerToken = readBearerToken(readHeader(req, 'authorization'));
    if (headerToken) {
      return this.resolveToken(headerToken);
    }
    const subprotocolToken = readBearerSubprotocol(readHeader(req, 'sec-websocket-protocol'));
    if (subprotocolToken) {
      return this.resolveToken(subprotocolToken);
    }
    const cookieValue = readHeader(req, 'cookie');
    const sessionToken = readSessionCookie(cookieValue);
    if (sessionToken) {
      return this.resolver.resolveSessionToken(sessionToken);
    }
    return null;
  }

  private async resolveToken(raw: string): Promise<ResolvedCredential | null> {
    if (looksLikeApiKey(raw)) {
      let credential = await this.resolver.resolveApiKey(raw);
      if (!credential) {
        for (const extra of this.additionalResolvers) {
          credential = await extra.resolve(raw);
          if (credential) break;
        }
      }
      return credential;
    }
    return this.resolver.resolveBearerToken(raw);
  }
}

const SESSION_COOKIE_NAMES = [
  'better-auth.session_token',
  '__Secure-better-auth.session_token',
];

function readHeader(req: IncomingMessage, name: string): string | undefined {
  const headers = req.headers as Record<string, string | string[] | undefined>;
  const raw = headers[name];
  if (Array.isArray(raw)) return raw[0];
  return raw;
}

function readBearerToken(value: string | undefined): string | null {
  if (!value || !value.toLowerCase().startsWith('bearer ')) return null;
  const raw = value.slice('Bearer '.length).trim();
  return raw.length > 0 ? raw : null;
}

/**
 * Browser WebSocket clients pass the bearer token as the second value in
 * `Sec-WebSocket-Protocol: bearer, <token>`. The header may concatenate
 * multiple `Sec-WebSocket-Protocol` lines into a single comma-separated
 * value; we only honor the first `bearer + token` pair we find.
 */
export function readBearerSubprotocol(value: string | undefined): string | null {
  if (!value) return null;
  const parts = value
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  for (let i = 0; i < parts.length - 1; i += 1) {
    if (parts[i]?.toLowerCase() === 'bearer') {
      return parts[i + 1] ?? null;
    }
  }
  return null;
}

function readSessionCookie(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    if (!SESSION_COOKIE_NAMES.includes(name)) continue;
    const raw = decodeURIComponent(part.slice(eq + 1).trim());
    const dot = raw.indexOf('.');
    return dot >= 0 ? raw.slice(0, dot) : raw;
  }
  return null;
}

function looksLikeApiKey(raw: string): boolean {
  return /^mn_[a-z]+_[A-Za-z0-9_-]+$/.test(raw);
}

function encodeChannel(msg: ClientMessage): string | null {
  if (msg.channel === 'org') return 'org';
  if (msg.channel === 'conversation' && msg.id) return `conversation:${msg.id}`;
  if (msg.channel === 'contact' && msg.id) return `contact:${msg.id}`;
  return null;
}

function channelMatches(channel: string, event: EventRow): boolean {
  if (channel === 'org') return true;
  if (channel.startsWith('conversation:')) {
    const id = channel.slice('conversation:'.length);
    return event.payload?.['conversationId'] === id;
  }
  if (channel.startsWith('contact:')) {
    const id = channel.slice('contact:'.length);
    return event.payload?.['contactId'] === id;
  }
  return false;
}

function ownsEvent(event: EventRow, endUserId: string): boolean {
  const owner = event.payload?.['endUserId'];
  if (typeof owner === 'string') return owner === endUserId;
  return event.type.startsWith('conversation.');
}
