import type { VoiceDescriptor, VoiceSession } from './types.ts';
import { VapiVoiceSession } from './vendors/vapi.ts';

export function createVoiceSession(descriptor: VoiceDescriptor): VoiceSession {
  switch (descriptor.vendor) {
    case 'vapi':
      return new VapiVoiceSession(descriptor);
    default: {
      const exhaustive: never = descriptor.vendor;
      throw new Error(`unsupported voice vendor: ${String(exhaustive)}`);
    }
  }
}
