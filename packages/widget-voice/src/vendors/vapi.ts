import VapiCtor from '@vapi-ai/web';
import type {
  VoiceDescriptor,
  VoiceSession,
  VoiceSessionEvent,
  VoiceSessionListener,
  VoiceSessionState,
} from '../types.ts';

type VapiInstance = InstanceType<typeof VapiCtor>;

type VapiStartArgs = Parameters<VapiInstance['start']>;
type VapiAssistantArg = Exclude<VapiStartArgs[0], string | undefined>;
type VapiOverridesArg = NonNullable<VapiStartArgs[1]>;

type VapiDescriptor = Extract<VoiceDescriptor, { vendor: 'vapi' }>;

interface VapiMessage {
  type?: string;
  role?: 'user' | 'assistant' | 'system';
  transcript?: string;
  transcriptType?: 'partial' | 'final';
}

export class VapiVoiceSession implements VoiceSession {
  private vapi: VapiInstance | null = null;
  private listeners = new Set<VoiceSessionListener>();
  private muted = false;
  private currentState: VoiceSessionState = 'idle';

  constructor(private readonly descriptor: VapiDescriptor) {}

  get state(): VoiceSessionState {
    return this.currentState;
  }

  subscribe(listener: VoiceSessionListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async start(): Promise<void> {
    if (this.vapi) throw new Error('voice_session_already_started');
    this.setState('connecting');
    this.vapi = new VapiCtor(this.descriptor.publicKey);
    this.attachEventHandlers(this.vapi);
    try {
      if (this.descriptor.assistant) {
        const inline = {
          ...this.descriptor.assistant,
          metadata: this.descriptor.metadata,
        } as VapiAssistantArg;
        const overrides: VapiOverridesArg = { metadata: this.descriptor.metadata };
        if (typeof console !== 'undefined' && typeof console.info === 'function') {
          console.info('[munin-voice] vapi.start inline payload:', inline, 'overrides:', overrides);
        }
        await this.vapi.start(inline, overrides);
      } else {
        const overrides: VapiOverridesArg = {
          metadata: this.descriptor.metadata,
          ...(this.descriptor.assistantOverrides ?? {}),
        };
        await this.vapi.start(this.descriptor.assistantId, overrides);
      }
    } catch (err) {
      this.emit({ type: 'error', error: toError(err) });
      this.setState('error');
      throw err;
    }
  }

  async end(): Promise<void> {
    if (!this.vapi) return;
    try {
      await this.vapi.stop();
    } finally {
      this.vapi = null;
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.vapi?.setMuted(muted);
  }

  isMuted(): boolean {
    if (this.vapi) return this.vapi.isMuted();
    return this.muted;
  }

  private attachEventHandlers(vapi: VapiInstance): void {
    vapi.on('call-start', () => {
      this.setState('listening');
    });
    vapi.on('speech-start', () => {
      this.setState('speaking');
    });
    vapi.on('speech-end', () => {
      this.setState('listening');
    });
    vapi.on('call-end', () => {
      this.setState('ended');
    });
    vapi.on('error', (err: unknown) => {
      this.emit({ type: 'error', error: toError(err) });
      this.setState('error');
    });
    vapi.on('message', (raw: VapiMessage) => {
      if (raw.type !== 'transcript') return;
      const role = raw.role === 'assistant' ? 'assistant' : 'user';
      const text = (raw.transcript ?? '').trim();
      if (!text) return;
      this.emit({
        type: 'transcript',
        payload: {
          role,
          text,
          final: raw.transcriptType !== 'partial',
        },
      });
    });
  }

  private setState(next: VoiceSessionState): void {
    if (this.currentState === next) return;
    if (
      (this.currentState === 'ended' || this.currentState === 'error') &&
      next !== 'idle'
    ) {
      return;
    }
    this.currentState = next;
    this.emit({ type: 'state', state: next });
  }

  private emit(event: VoiceSessionEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        console.debug('[munin-voice] vapi listener threw:', err);
      }
    }
  }
}

function toError(err: unknown): Error {
  if (err instanceof Error) return err;
  if (typeof err === 'string') return new Error(err);
  try {
    return new Error(JSON.stringify(err));
  } catch {
    return new Error('unknown_voice_error');
  }
}
