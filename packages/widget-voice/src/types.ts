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

export interface VapiVoiceDescriptor {
  vendor: 'vapi';
  transport?: 'sdk';
  publicKey: string;
  assistantId: string;
  metadata: VoiceSessionMetadata;
  assistant?: Record<string, unknown>;
  assistantOverrides?: Record<string, unknown>;
}

/**
 * Generic browser-WebRTC descriptor for vendors that expose raw signaling
 * (a WebSocket + single-use token + ICE servers) instead of a drop-in SDK.
 * `signalingProtocol` selects the registered signaling adapter that knows the
 * vendor's WS message framing; everything else (peer connection, media, state)
 * is handled generically by WebRtcVoiceSession.
 */
export interface WebRtcVoiceDescriptor {
  vendor: string;
  transport: 'webrtc';
  signalingProtocol: string;
  signalingUrl: string;
  token: string;
  sessionId: string;
  iceServers: RTCIceServer[];
  metadata: VoiceSessionMetadata;
}

export type VoiceDescriptor = VapiVoiceDescriptor | WebRtcVoiceDescriptor;

export type VoiceVendor = VoiceDescriptor['vendor'];
