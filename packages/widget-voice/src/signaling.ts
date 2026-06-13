import type { VoiceTranscriptEvent } from './types.ts';

/**
 * Callbacks the generic WebRtcVoiceSession registers with a SignalingChannel.
 * A channel translates the vendor's WebSocket message framing into these.
 */
export interface SignalingHandlers {
  /** Remote SDP answer received. */
  onAnswer(sdp: string): void;
  /** Remote trickle ICE candidate (vendors that embed ICE in the answer never call this). */
  onRemoteCandidate(candidate: RTCIceCandidateInit): void;
  /** A transcript turn delivered over the signaling channel, if the vendor supports it. */
  onTranscript(event: VoiceTranscriptEvent): void;
  /** A vendor-specific lifecycle/state string, if delivered over the channel. */
  onRemoteState(state: string): void;
  /** The signaling channel closed. */
  onClosed(): void;
  /** A transport-level error. */
  onError(error: Error): void;
}

/**
 * The vendor-specific half of the in-browser WebRTC path: owns the WebSocket
 * and the vendor's message framing. The generic session owns the peer
 * connection and media. Add a new SDK-less vendor by implementing this and
 * registering it under a protocol name.
 */
export interface SignalingChannel {
  open(handlers: SignalingHandlers): Promise<void>;
  sendOffer(sdp: string): void;
  sendCandidate(candidate: RTCIceCandidateInit): void;
  sendEndOfCandidates(): void;
  close(): void;
}

export interface SignalingChannelOptions {
  url: string;
  token: string;
  sessionId: string;
}

export type SignalingChannelFactory = (opts: SignalingChannelOptions) => SignalingChannel;

const registry = new Map<string, SignalingChannelFactory>();

export function registerSignalingProtocol(name: string, factory: SignalingChannelFactory): void {
  registry.set(name, factory);
}

export function createSignalingChannel(
  name: string,
  opts: SignalingChannelOptions,
): SignalingChannel {
  const factory = registry.get(name);
  if (!factory) throw new Error(`unsupported signaling protocol: ${name}`);
  return factory(opts);
}
