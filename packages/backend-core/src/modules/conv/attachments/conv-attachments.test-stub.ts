import type { MessageAttachmentGateway } from './conv-attachments.types.ts';

export function stubAttachmentGateway(): MessageAttachmentGateway {
  return {
    attachToMessage: () => Promise.resolve([]),
    projectForMessage: () => [],
    hydrateProjection: () => [],
    hydrateRaw: () => [],
  };
}
