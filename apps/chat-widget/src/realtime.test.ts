import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRealtimeClient, type WebSocketLike } from './realtime.ts';

/**
 * In-process WebSocket harness. Tests instantiate `MockWebSocket` via the
 * client's `webSocketCtor` injection point, drive opens / messages /
 * closes, and assert on what the client sent. Each instance is captured
 * in `MockWebSocket.instances` so the test can grab the latest.
 */
class MockWebSocket implements WebSocketLike {
  static instances: MockWebSocket[] = [];
  static OPEN = 1;
  static CLOSED = 3;

  readyState = 0; // CONNECTING
  sent: string[] = [];
  url: string;
  protocols?: string | string[];
  private listeners: Record<string, Array<(arg: unknown) => void>> = {};

  constructor(url: string, protocols?: string | string[]) {
    this.url = url;
    this.protocols = protocols;
    MockWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: (arg?: unknown) => void): void {
    (this.listeners[type] ??= []).push(listener);
  }

  send(data: string): void {
    if (this.readyState !== MockWebSocket.OPEN) throw new Error('not open');
    this.sent.push(data);
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.fire('close', undefined);
  }

  // Test driver helpers:
  fakeOpen(): void {
    this.readyState = MockWebSocket.OPEN;
    this.fire('open', undefined);
  }

  fakeMessage(payload: unknown): void {
    this.fire('message', { data: JSON.stringify(payload) });
  }

  fakeClose(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.fire('close', undefined);
  }

  fakeError(): void {
    this.fire('error', new Error('mock error'));
  }

  fakeRawMessage(raw: string): void {
    this.fire('message', { data: raw });
  }

  private fire(type: string, arg: unknown): void {
    for (const l of this.listeners[type] ?? []) l(arg);
  }
}

const MockWS = MockWebSocket as unknown as {
  new (url: string, protocols?: string | string[]): WebSocketLike;
  readonly OPEN: number;
  readonly CLOSED: number;
};

beforeEach(() => {
  MockWebSocket.instances = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe('realtime: connection lifecycle', () => {
  it('opens, subscribes, and emits connected state', () => {
    const states: string[] = [];
    const client = createRealtimeClient({
      host: 'https://munin.example',
      widgetKey: 'mn_widget_abc',
      channelId: 'cnv_chan',
      sessionId: 'sess_1',
      webSocketCtor: MockWS,
    });
    client.onState((s) => states.push(s));
    client.connect();
    expect(states).toEqual(['connecting']);
    const ws = MockWebSocket.instances.at(-1)!;
    expect(ws.url).toBe('wss://munin.example/api/v1/realtime');
    expect(ws.protocols).toEqual(['bearer', 'mn_widget_abc']);
    ws.fakeOpen();
    expect(states).toEqual(['connecting', 'connected']);
    expect(ws.sent).toHaveLength(1);
    const msg = JSON.parse(ws.sent[0]!) as Record<string, unknown>;
    expect(msg).toMatchObject({
      type: 'subscribe',
      channel: 'widget',
      channelId: 'cnv_chan',
      sessionId: 'sess_1',
    });
    client.close();
  });

  it('appends identity query params when identity is present', () => {
    const client = createRealtimeClient({
      host: 'https://munin.example',
      widgetKey: 'mn_widget_abc',
      channelId: 'cnv_chan',
      sessionId: 'sess_1',
      identity: { externalId: 'user_42', userHash: 'a'.repeat(64) },
      webSocketCtor: MockWS,
    });
    client.connect();
    const ws = MockWebSocket.instances.at(-1)!;
    expect((ws).url).toContain('externalId=user_42');
    expect((ws).url).toContain(`userHash=${'a'.repeat(64)}`);
    client.close();
  });

  it('routes incoming event messages to onEvent listeners', () => {
    const client = createRealtimeClient({
      host: 'https://munin.example',
      widgetKey: 'mn_widget_abc',
      channelId: 'cnv_chan',
      sessionId: 'sess_1',
      webSocketCtor: MockWS,
    });
    const events: unknown[] = [];
    client.onEvent((m) => events.push(m));
    client.connect();
    const ws = MockWebSocket.instances.at(-1)!;
    ws.fakeOpen();
    ws.fakeMessage({
      type: 'event',
      channel: 'widget:cnv_chan:sess_1',
      event: { type: 'conversation.message.sent', payload: { conversationId: 'cnv_1' } },
    });
    expect(events).toHaveLength(1);
    client.close();
  });

  it('routes incoming typing messages to onTyping listeners', () => {
    const client = createRealtimeClient({
      host: 'https://munin.example',
      widgetKey: 'mn_widget_abc',
      channelId: 'cnv_chan',
      sessionId: 'sess_1',
      webSocketCtor: MockWS,
    });
    const typing: unknown[] = [];
    client.onTyping((m) => typing.push(m));
    client.connect();
    const ws = MockWebSocket.instances.at(-1)!;
    ws.fakeOpen();
    ws.fakeMessage({
      type: 'typing',
      channel: 'widget:cnv_chan:sess_1',
      isTyping: true,
      authorType: 'operator',
    });
    expect(typing).toHaveLength(1);
    expect(typing[0]).toMatchObject({ isTyping: true, authorType: 'operator' });
    client.close();
  });

  it('ignores malformed inbound JSON without throwing', () => {
    const client = createRealtimeClient({
      host: 'https://munin.example',
      widgetKey: 'mn_widget_abc',
      channelId: 'cnv_chan',
      sessionId: 'sess_1',
      webSocketCtor: MockWS,
    });
    client.connect();
    const ws = MockWebSocket.instances.at(-1)!;
    ws.fakeOpen();
    // Inject raw invalid data via the test driver.
    expect(() => (ws).fakeRawMessage('{not valid')).not.toThrow();
    client.close();
  });
});

describe('realtime: typing throttle', () => {
  it('drops repeat typing:true within the 1.5 s window', () => {
    vi.useFakeTimers();
    const start = new Date('2026-05-09T12:00:00.000Z').getTime();
    vi.setSystemTime(start);
    const client = createRealtimeClient({
      host: 'https://munin.example',
      widgetKey: 'mn_widget_abc',
      channelId: 'cnv_chan',
      sessionId: 'sess_1',
      webSocketCtor: MockWS,
    });
    client.connect();
    const ws = MockWebSocket.instances.at(-1)!;
    ws.fakeOpen();
    // First subscribe message is at index 0; reset.
    ws.sent.length = 0;

    client.sendTyping(true);
    vi.setSystemTime(start + 200);
    client.sendTyping(true);
    vi.setSystemTime(start + 1000);
    client.sendTyping(true);
    expect(ws.sent).toHaveLength(1);
    expect((JSON.parse(ws.sent[0]!) as { isTyping: boolean }).isTyping).toBe(true);

    // After 1.5 s the throttle releases.
    vi.setSystemTime(start + 1600);
    client.sendTyping(true);
    expect(ws.sent).toHaveLength(2);
    client.close();
  });

  it('always sends typing:false (cancels the throttle)', () => {
    vi.useFakeTimers();
    const start = new Date('2026-05-09T12:00:00.000Z').getTime();
    vi.setSystemTime(start);
    const client = createRealtimeClient({
      host: 'https://munin.example',
      widgetKey: 'mn_widget_abc',
      channelId: 'cnv_chan',
      sessionId: 'sess_1',
      webSocketCtor: MockWS,
    });
    client.connect();
    const ws = MockWebSocket.instances.at(-1)!;
    ws.fakeOpen();
    ws.sent.length = 0;

    client.sendTyping(true);
    vi.setSystemTime(start + 100);
    client.sendTyping(false);
    expect(ws.sent).toHaveLength(2);
    expect((JSON.parse(ws.sent[1]!) as { isTyping: boolean }).isTyping).toBe(false);
    client.close();
  });

  it('drops typing while disconnected', () => {
    const client = createRealtimeClient({
      host: 'https://munin.example',
      widgetKey: 'mn_widget_abc',
      channelId: 'cnv_chan',
      sessionId: 'sess_1',
      webSocketCtor: MockWS,
    });
    // No connect() — sendTyping should be a silent no-op, not throw.
    expect(() => client.sendTyping(true)).not.toThrow();
  });
});

describe('realtime: reconnect with exp backoff', () => {
  it('schedules a reconnect after close and re-emits connected on reopen', () => {
    vi.useFakeTimers();
    const states: string[] = [];
    const client = createRealtimeClient({
      host: 'https://munin.example',
      widgetKey: 'mn_widget_abc',
      channelId: 'cnv_chan',
      sessionId: 'sess_1',
      webSocketCtor: MockWS,
    });
    client.onState((s) => states.push(s));
    client.connect();
    const ws1 = MockWebSocket.instances.at(-1)!;
    ws1.fakeOpen();
    expect(states).toEqual(['connecting', 'connected']);
    ws1.fakeClose();
    expect(states.at(-1)).toBe('reconnecting');
    expect(MockWebSocket.instances).toHaveLength(1);

    // First retry uses ~250 ms + jitter; advancing 600 ms is enough.
    vi.advanceTimersByTime(600);
    expect(MockWebSocket.instances).toHaveLength(2);
    const ws2 = MockWebSocket.instances.at(-1)!;
    ws2.fakeOpen();
    expect(states.at(-1)).toBe('connected');
    client.close();
  });

  it('does not reconnect after caller-initiated close', () => {
    vi.useFakeTimers();
    const client = createRealtimeClient({
      host: 'https://munin.example',
      widgetKey: 'mn_widget_abc',
      channelId: 'cnv_chan',
      sessionId: 'sess_1',
      webSocketCtor: MockWS,
    });
    client.connect();
    MockWebSocket.instances.at(-1)!.fakeOpen();
    client.close();
    vi.advanceTimersByTime(60_000);
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(client.state()).toBe('closed');
  });

  it('grows backoff exponentially on repeated failures (250, 500, 1000…ms before jitter)', () => {
    vi.useFakeTimers();
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const client = createRealtimeClient({
      host: 'https://munin.example',
      widgetKey: 'mn_widget_abc',
      channelId: 'cnv_chan',
      sessionId: 'sess_1',
      webSocketCtor: MockWS,
    });
    client.connect();
    // No fakeOpen — close immediately, three times in a row.
    for (let i = 0; i < 3; i++) {
      MockWebSocket.instances.at(-1)!.fakeClose();
      vi.advanceTimersByTime(60_000);
    }
    // The first call is the initial connect (no setTimeout). Reconnects
    // after each close use setTimeout. Extract the delays passed.
    const delays = setTimeoutSpy.mock.calls
      .map((c) => Number(c[1]))
      .filter((n) => n >= 250 && n <= 31_000);
    // Expect each successive delay to be ≥ the previous (within jitter).
    for (let i = 1; i < delays.length; i++) {
      expect(delays[i]).toBeGreaterThanOrEqual(delays[i - 1]! - 250);
    }
    // And the third delay should be at least 1000 (+ jitter).
    expect(delays[2] ?? 0).toBeGreaterThanOrEqual(1000);
    client.close();
    setTimeoutSpy.mockRestore();
  });
});

describe('realtime: no-poll invariant', () => {
  it('createRealtimeClient never installs a setInterval', () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const client = createRealtimeClient({
      host: 'https://munin.example',
      widgetKey: 'mn_widget_abc',
      channelId: 'cnv_chan',
      sessionId: 'sess_1',
      webSocketCtor: MockWS,
    });
    client.connect();
    MockWebSocket.instances.at(-1)!.fakeOpen();
    expect(setIntervalSpy).not.toHaveBeenCalled();
    client.close();
    setIntervalSpy.mockRestore();
  });
});
