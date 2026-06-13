import { createSignalingChannel } from './signaling.ts';
import type { VoiceDescriptor, VoiceSession } from './types.ts';
import { VapiVoiceSession } from './vendors/vapi.ts';
import './vendors/threll-signaling.ts';
import { WebRtcVoiceSession } from './webrtc-session.ts';

export function createVoiceSession(descriptor: VoiceDescriptor): VoiceSession {
  if (descriptor.transport === 'webrtc') {
    const channel = createSignalingChannel(descriptor.signalingProtocol, {
      url: descriptor.signalingUrl,
      token: descriptor.token,
      sessionId: descriptor.sessionId,
    });
    return new WebRtcVoiceSession(descriptor, channel);
  }
  if (descriptor.vendor === 'vapi') {
    return new VapiVoiceSession(descriptor);
  }
  const exhaustive: never = descriptor;
  throw new Error(`unsupported voice descriptor: ${JSON.stringify(exhaustive)}`);
}
