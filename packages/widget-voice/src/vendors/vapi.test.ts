import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@vapi-ai/web', () => {
  type EventName =
    | 'call-start'
    | 'call-end'
    | 'speech-start'
    | 'speech-end'
    | 'message'
    | 'error';

  class FakeVapi {
    static lastInstance: FakeVapi | null = null;
    static startError: Error | null = null;
    publicKey: string;
    startedWith: { assistantId: string | undefined; overrides: unknown } | null = null;
    private listeners = new Map<EventName, Array<(arg?: unknown) => void>>();
    private muted = false;
    stopped = false;

    constructor(publicKey: string) {
      this.publicKey = publicKey;
      FakeVapi.lastInstance = this;
    }

    on(event: EventName, fn: (arg?: unknown) => void): this {
      const arr = this.listeners.get(event) ?? [];
      arr.push(fn);
      this.listeners.set(event, arr);
      return this;
    }

    start(assistantId?: string, overrides?: unknown): Promise<null> {
      this.startedWith = { assistantId, overrides };
      if (FakeVapi.startError) return Promise.reject(FakeVapi.startError);
      return Promise.resolve(null);
    }

    stop(): Promise<void> {
      this.stopped = true;
      return Promise.resolve();
    }

    setMuted(muted: boolean): void {
      this.muted = muted;
    }

    isMuted(): boolean {
      return this.muted;
    }

    emit(event: EventName, arg?: unknown): void {
      const arr = this.listeners.get(event) ?? [];
      for (const fn of arr) fn(arg);
    }
  }

  return { default: FakeVapi };
});

import VapiCtor from '@vapi-ai/web';
import { VapiVoiceSession } from './vapi.js';
import type { VoiceSessionEvent } from '../types.js';

interface FakeVapiShape {
  publicKey: string;
  startedWith: { assistantId: string | undefined; overrides: unknown } | null;
  stopped: boolean;
  isMuted(): boolean;
  emit(event: string, arg?: unknown): void;
}
type FakeVapiStatic = typeof VapiCtor & {
  lastInstance: FakeVapiShape | null;
  startError: Error | null;
};

function descriptor() {
  return {
    vendor: 'vapi' as const,
    publicKey: 'pk_test_123',
    assistantId: 'asst_test',
    metadata: { conversationId: 'ccv_test', endUserId: 'eu_test' },
  };
}

describe('VapiVoiceSession', () => {
  const FakeVapi = VapiCtor as unknown as FakeVapiStatic;

  beforeEach(() => {
    FakeVapi.lastInstance = null;
    FakeVapi.startError = null;
  });

  it('passes the public key, assistant id, and metadata to Vapi', async () => {
    const session = new VapiVoiceSession(descriptor());
    await session.start();
    const v = FakeVapi.lastInstance!;
    expect(v.publicKey).toBe('pk_test_123');
    expect(v.startedWith?.assistantId).toBe('asst_test');
    expect(v.startedWith?.overrides).toEqual({
      metadata: { conversationId: 'ccv_test', endUserId: 'eu_test' },
    });
  });

  it('emits state transitions in order: connecting → listening → speaking → listening → ended', async () => {
    const events: VoiceSessionEvent[] = [];
    const session = new VapiVoiceSession(descriptor());
    session.subscribe((e) => events.push(e));
    await session.start();
    const v = FakeVapi.lastInstance!;
    v.emit('call-start');
    v.emit('speech-start');
    v.emit('speech-end');
    v.emit('call-end');

    const states = events
      .filter((e): e is Extract<VoiceSessionEvent, { type: 'state' }> => e.type === 'state')
      .map((e) => e.state);
    expect(states).toEqual(['connecting', 'listening', 'speaking', 'listening', 'ended']);
  });

  it('emits final transcripts with the correct role', async () => {
    const events: VoiceSessionEvent[] = [];
    const session = new VapiVoiceSession(descriptor());
    session.subscribe((e) => events.push(e));
    await session.start();
    const v = FakeVapi.lastInstance!;
    v.emit('message', {
      type: 'transcript',
      role: 'user',
      transcript: 'Hello there',
      transcriptType: 'final',
    });
    v.emit('message', {
      type: 'transcript',
      role: 'assistant',
      transcript: 'Hi! How can I help?',
      transcriptType: 'final',
    });

    const transcripts = events.filter(
      (e): e is Extract<VoiceSessionEvent, { type: 'transcript' }> => e.type === 'transcript',
    );
    expect(transcripts).toHaveLength(2);
    expect(transcripts[0]!.payload).toEqual({ role: 'user', text: 'Hello there', final: true });
    expect(transcripts[1]!.payload).toEqual({
      role: 'assistant',
      text: 'Hi! How can I help?',
      final: true,
    });
  });

  it('marks partial transcripts as final=false', async () => {
    const events: VoiceSessionEvent[] = [];
    const session = new VapiVoiceSession(descriptor());
    session.subscribe((e) => events.push(e));
    await session.start();
    FakeVapi.lastInstance!.emit('message', {
      type: 'transcript',
      role: 'user',
      transcript: 'I want to ch—',
      transcriptType: 'partial',
    });
    const t = events.find(
      (e): e is Extract<VoiceSessionEvent, { type: 'transcript' }> => e.type === 'transcript',
    );
    expect(t?.payload.final).toBe(false);
  });

  it('ignores non-transcript messages and empty transcripts', async () => {
    const events: VoiceSessionEvent[] = [];
    const session = new VapiVoiceSession(descriptor());
    session.subscribe((e) => events.push(e));
    await session.start();
    const v = FakeVapi.lastInstance!;
    v.emit('message', { type: 'status-update', status: 'queued' });
    v.emit('message', { type: 'transcript', role: 'user', transcript: '   ' });

    const transcripts = events.filter((e) => e.type === 'transcript');
    expect(transcripts).toHaveLength(0);
  });

  it('emits an error event and transitions to error on vapi.error', async () => {
    const events: VoiceSessionEvent[] = [];
    const session = new VapiVoiceSession(descriptor());
    session.subscribe((e) => events.push(e));
    await session.start();
    FakeVapi.lastInstance!.emit('error', new Error('webrtc_failure'));

    const errorEvents = events.filter((e) => e.type === 'error');
    expect(errorEvents).toHaveLength(1);
    expect(session.state).toBe('error');
  });

  it('throws and emits error if vapi.start() rejects', async () => {
    FakeVapi.startError = new Error('mic_permission_denied');
    const events: VoiceSessionEvent[] = [];
    const session = new VapiVoiceSession(descriptor());
    session.subscribe((e) => events.push(e));
    await expect(session.start()).rejects.toThrow('mic_permission_denied');
    expect(session.state).toBe('error');
    expect(events.find((e) => e.type === 'error')).toBeTruthy();
  });

  it('refuses double-start', async () => {
    const session = new VapiVoiceSession(descriptor());
    await session.start();
    await expect(session.start()).rejects.toThrow(/already_started/);
  });

  it('forwards setMuted to vapi after start', async () => {
    const session = new VapiVoiceSession(descriptor());
    await session.start();
    session.setMuted(true);
    expect(FakeVapi.lastInstance!.isMuted()).toBe(true);
    expect(session.isMuted()).toBe(true);
  });

  it('end() stops the call and is idempotent', async () => {
    const session = new VapiVoiceSession(descriptor());
    await session.start();
    await session.end();
    expect(FakeVapi.lastInstance!.stopped).toBe(true);
    await session.end();
  });

  it('unsubscribe() stops receiving events', async () => {
    const events: VoiceSessionEvent[] = [];
    const session = new VapiVoiceSession(descriptor());
    const off = session.subscribe((e) => events.push(e));
    await session.start();
    off();
    FakeVapi.lastInstance!.emit('call-start');
    const states = events.filter((e) => e.type === 'state').map((e) => e.state);
    expect(states).toEqual(['connecting']);
  });
});
