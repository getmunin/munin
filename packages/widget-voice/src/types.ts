export type VoiceSessionState =
  | 'idle'
  | 'connecting'
  | 'listening'
  | 'speaking'
  | 'ended'
  | 'error';

export interface VoiceTranscriptEvent {
  role: 'user' | 'assistant';
  text: string;
  final: boolean;
}

export type VoiceSessionEvent =
  | { type: 'state'; state: VoiceSessionState }
  | { type: 'transcript'; payload: VoiceTranscriptEvent }
  | { type: 'error'; error: Error };

export type VoiceSessionListener = (event: VoiceSessionEvent) => void;

export interface VoiceSession {
  readonly state: VoiceSessionState;
  start(): Promise<void>;
  end(): Promise<void>;
  setMuted(muted: boolean): void;
  isMuted(): boolean;
  subscribe(listener: VoiceSessionListener): () => void;
}

export interface VoiceSessionMetadata {
  conversationId: string;
  endUserId: string;
}

export type VoiceDescriptor =
  | {
      vendor: 'vapi';
      publicKey: string;
      assistantId: string;
      metadata: VoiceSessionMetadata;
      assistant?: Record<string, unknown>;
      assistantOverrides?: Record<string, unknown>;
    };

export type VoiceVendor = VoiceDescriptor['vendor'];
