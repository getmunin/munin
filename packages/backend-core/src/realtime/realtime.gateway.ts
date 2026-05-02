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

    this.wss = new WebSocketServer({ noServer: true });
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
      this.logger.debug(`upgrade auth failed: ${err instanceof Error ? err.message : err}`);
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
    this.wss.handleUpgrade(req, socket, head, (ws) => {
      this.handleConnection(ws, credential!);
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
        msg = JSON.parse(data.toString()) as ClientMessage;
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
    const auth = req.headers['authorization'];
    const value = Array.isArray(auth) ? auth[0] : auth;
    if (value && value.toLowerCase().startsWith('bearer ')) {
      const raw = value.slice('Bearer '.length).trim();
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
    const cookie = req.headers['cookie'];
    const cookieValue = Array.isArray(cookie) ? cookie[0] : cookie;
    const sessionToken = readSessionCookie(cookieValue);
    if (sessionToken) {
      return this.resolver.resolveSessionToken(sessionToken);
    }
    return null;
  }
}

const SESSION_COOKIE_NAMES = [
  'better-auth.session_token',
  '__Secure-better-auth.session_token',
];

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
