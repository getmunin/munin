import { WebSocket } from 'ws';

export interface MessageReceivedEvent {
  conversationId: string;
  messageId: string;
  authorType: 'user' | 'agent' | 'end_user' | 'system';
  endUserId?: string;
}

export interface KbDocumentChangedEvent {
  type: 'created' | 'updated' | 'deleted';
  spaceId: string;
  documentId: string;
  slug: string | null;
  version?: number;
}

export interface HandoverResolvedEvent {
  conversationId: string;
  messageId: string;
  authorType: 'user' | 'agent' | 'end_user' | 'system';
}

export interface RealtimeClientOptions {
  baseUrl: string;
  adminApiKey: string;
  onMessageReceived: (event: MessageReceivedEvent) => void;
  onKbDocumentChanged?: (event: KbDocumentChangedEvent) => void;
  onHandoverResolved?: (event: HandoverResolvedEvent) => void;
  logger?: { info: (msg: string) => void; warn: (msg: string) => void; error: (msg: string) => void };
}

export interface RealtimeClient {
  start(): void;
  stop(): Promise<void>;
}

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30_000;
const PING_INTERVAL_MS = 30_000;

export function createRealtimeClient(opts: RealtimeClientOptions): RealtimeClient {
  const log = opts.logger ?? {
    info: (m) => console.log(`[realtime] ${m}`),
    warn: (m) => console.warn(`[realtime] ${m}`),
    error: (m) => console.error(`[realtime] ${m}`),
  };

  let ws: WebSocket | null = null;
  let pingTimer: NodeJS.Timeout | null = null;
  let reconnectTimer: NodeJS.Timeout | null = null;
  let attempt = 0;
  let stopped = false;

  function clearTimers(): void {
    if (pingTimer) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function scheduleReconnect(): void {
    if (stopped) return;
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** attempt, RECONNECT_MAX_MS);
    attempt += 1;
    log.info(`reconnecting in ${delay}ms (attempt ${attempt})`);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  }

  function connect(): void {
    if (stopped) return;
    const url = `${opts.baseUrl.replace(/^http/, 'ws').replace(/\/+$/, '')}/api/realtime`;
    const socket = new WebSocket(url, {
      headers: { authorization: `Bearer ${opts.adminApiKey}` },
    });
    ws = socket;

    socket.on('open', () => {
      log.info('connected');
      attempt = 0;
      socket.send(JSON.stringify({ type: 'subscribe', channel: 'org' }));
      pingTimer = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'ping' }));
        }
      }, PING_INTERVAL_MS);
    });

    socket.on('message', (raw) => {
      try {
        const text = Buffer.isBuffer(raw)
          ? raw.toString('utf8')
          : Array.isArray(raw)
            ? Buffer.concat(raw).toString('utf8')
            : Buffer.from(raw).toString('utf8');
        const msg = JSON.parse(text) as {
          type: string;
          event?: { type?: string; payload?: Record<string, unknown> };
        };
        if (msg.type !== 'event' || !msg.event) return;
        const eventType = msg.event.type ?? '';
        const payload = msg.event.payload ?? {};

        if (eventType === 'conversation.message.received') {
          const conversationId = payload['conversationId'];
          const messageId = payload['messageId'];
          const authorType = payload['authorType'];
          if (typeof conversationId !== 'string' || typeof messageId !== 'string') return;
          opts.onMessageReceived({
            conversationId,
            messageId,
            authorType:
              typeof authorType === 'string'
                ? (authorType as MessageReceivedEvent['authorType'])
                : 'end_user',
            endUserId: typeof payload['endUserId'] === 'string' ? payload['endUserId'] : undefined,
          });
          return;
        }

        if (opts.onHandoverResolved && eventType === 'conversation.handover_resolved') {
          const conversationId = payload['conversationId'];
          const messageId = payload['messageId'];
          const authorType = payload['authorType'];
          if (typeof conversationId !== 'string' || typeof messageId !== 'string') return;
          opts.onHandoverResolved({
            conversationId,
            messageId,
            authorType:
              typeof authorType === 'string'
                ? (authorType as HandoverResolvedEvent['authorType'])
                : 'user',
          });
          return;
        }

        if (
          opts.onKbDocumentChanged &&
          (eventType === 'kb.document.created' ||
            eventType === 'kb.document.updated' ||
            eventType === 'kb.document.deleted')
        ) {
          const spaceId = payload['spaceId'];
          const documentId = payload['documentId'];
          if (typeof spaceId !== 'string' || typeof documentId !== 'string') return;
          opts.onKbDocumentChanged({
            type: eventType.split('.').pop() as 'created' | 'updated' | 'deleted',
            spaceId,
            documentId,
            slug: typeof payload['slug'] === 'string' ? payload['slug'] : null,
            version: typeof payload['version'] === 'number' ? payload['version'] : undefined,
          });
        }
      } catch (err) {
        log.warn(`failed to parse event: ${err instanceof Error ? err.message : String(err)}`);
      }
    });

    socket.on('close', (code) => {
      log.info(`closed (${code})`);
      clearTimers();
      ws = null;
      scheduleReconnect();
    });

    socket.on('error', (err) => {
      log.error(`socket error: ${err.message}`);
    });
  }

  return {
    start(): void {
      stopped = false;
      connect();
    },
    async stop(): Promise<void> {
      stopped = true;
      clearTimers();
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close(1000, 'shutdown');
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      ws = null;
    },
  };
}
