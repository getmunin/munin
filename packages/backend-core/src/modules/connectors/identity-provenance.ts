export type IdentityProvenance = 'authenticated' | 'channel_asserted' | 'self_reported';

export interface EndUserProvenanceMetadata {
  anonymous?: boolean;
  emailSource?: string;
}

const CHANNEL_ASSERTED_KINDS = new Set(['email', 'sms', 'voice']);

export function isSelfReportedIdentity(metadata: unknown): boolean {
  const meta = metadata as EndUserProvenanceMetadata | null;
  return meta?.anonymous === true || meta?.emailSource === 'visitor';
}

export function identityProvenance(args: {
  channelType?: string | null;
  metadata: unknown;
}): IdentityProvenance {
  if (isSelfReportedIdentity(args.metadata)) return 'self_reported';
  const channel = args.channelType?.trim().toLowerCase();
  if (!channel) return 'channel_asserted';
  if (CHANNEL_ASSERTED_KINDS.has(channel)) return 'channel_asserted';
  if (channel === 'chat') return 'authenticated';
  return 'channel_asserted';
}
