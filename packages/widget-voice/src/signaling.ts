import type { VoiceTranscriptEvent } from './types.ts';

export interface SignalingHandlers {
  onAnswer(sdp: string): void;
  onRemoteCandidate(candidate: RTCIceCandidateInit): void;
  onTranscript(event: VoiceTranscriptEvent): void;
  onRemoteState(state: string): void;
  onClosed(): void;
  onError(error: Error): void;
}

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
