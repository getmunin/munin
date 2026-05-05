import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WebSocketServer, type WebSocket } from 'ws';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  createRealtimeClient,
  type CuratorJobPendingEvent,
  type HandoverResolvedEvent,
  type MessageReceivedEvent,
} from './realtime.js';

describe('createRealtimeClient', () => {
  let httpServer: Server;
  let wss: WebSocketServer;
  let baseUrl: string;
  let connections: WebSocket[];

  beforeEach(async () => {
    connections = [];
    httpServer = createServer();
    wss = new WebSocketServer({ noServer: true });
    httpServer.on('upgrade', (req, socket, head) => {
      if (!req.url?.startsWith('/api/realtime')) {
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        connections.push(ws);
      });
    });
    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
    const port = (httpServer.address() as AddressInfo).port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    for (const c of connections) c.close();
    wss.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  });

  function send(eventType: string, payload: Record<string, unknown>): void {
    const conn = connections[0];
    if (!conn) throw new Error('no client connected yet');
    conn.send(JSON.stringify({ type: 'event', event: { type: eventType, payload } }));
  }

  async function waitForConnection(): Promise<void> {
    for (let i = 0; i < 50 && connections.length === 0; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    if (connections.length === 0) throw new Error('client never connected');
  }

  it('fires onMessageReceived on conversation.message.received', async () => {
    const events: MessageReceivedEvent[] = [];
    const client = createRealtimeClient({
      baseUrl,
      adminApiKey: 'mn_admin_test',
      onMessageReceived: (e) => events.push(e),
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    });
    client.start();
    await waitForConnection();
    send('conversation.message.received', {
      conversationId: 'ccv_1',
      messageId: 'cvm_1',
      authorType: 'end_user',
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    await client.stop();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      conversationId: 'ccv_1',
      messageId: 'cvm_1',
      authorType: 'end_user',
    });
  });

  it('fires onHandoverResolved on conversation.handover_resolved', async () => {
    const events: HandoverResolvedEvent[] = [];
    const client = createRealtimeClient({
      baseUrl,
      adminApiKey: 'mn_admin_test',
      onMessageReceived: () => {},
      onHandoverResolved: (e) => events.push(e),
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    });
    client.start();
    await waitForConnection();
    send('conversation.handover_resolved', {
      conversationId: 'ccv_2',
      messageId: 'cvm_2',
      authorType: 'user',
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    await client.stop();
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      conversationId: 'ccv_2',
      messageId: 'cvm_2',
      authorType: 'user',
    });
  });

  it('ignores conversation.handover_resolved when no callback is provided', async () => {
    const messages: MessageReceivedEvent[] = [];
    const client = createRealtimeClient({
      baseUrl,
      adminApiKey: 'mn_admin_test',
      onMessageReceived: (e) => messages.push(e),
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    });
    client.start();
    await waitForConnection();
    send('conversation.handover_resolved', {
      conversationId: 'ccv_x',
      messageId: 'cvm_x',
      authorType: 'user',
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    await client.stop();
    expect(messages).toHaveLength(0);
  });

  it('fires onCuratorJobPending on curator_job.pending', async () => {
    const events: CuratorJobPendingEvent[] = [];
    const client = createRealtimeClient({
      baseUrl,
      adminApiKey: 'mn_admin_test',
      onMessageReceived: () => {},
      onCuratorJobPending: (e) => events.push(e),
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    });
    client.start();
    await waitForConnection();
    const nextAttemptAt = new Date().toISOString();
    send('curator_job.pending', {
      jobId: 'cjob_xyz',
      skillUri: 'skill://kb/curation',
      dedupeKey: 'kb-curation:msg:cvm_1',
      nextAttemptAt,
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    await client.stop();
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      jobId: 'cjob_xyz',
      skillUri: 'skill://kb/curation',
      dedupeKey: 'kb-curation:msg:cvm_1',
      nextAttemptAt,
    });
  });
});
