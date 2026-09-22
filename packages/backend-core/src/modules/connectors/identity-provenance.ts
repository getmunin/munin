export type IdentityProvenance = 'authenticated' | 'channel_asserted' | 'self_reported';

export interface EndUserProvenanceMetadata {
  anonymous?: boolean;
  emailSource?: string;
  identitySource?: string;
}

const CHANNEL_ASSERTED_KINDS = new Set(['email', 'sms', 'voice']);

export const SMTP_VERIFIED_EMAIL_SOURCE = 'smtp-verified';
export const SMTP_UNVERIFIED_EMAIL_SOURCE = 'smtp-unverified';
export const CALLER_ID_IDENTITY_SOURCE = 'caller-id';

export function isSelfReportedIdentity(metadata: unknown): boolean {
  const meta = metadata as EndUserProvenanceMetadata | null;
  return meta?.anonymous === true || meta?.emailSource === 'visitor';
}

export function isProvenEmailOwnership(metadata: unknown): boolean {
  const meta = metadata as EndUserProvenanceMetadata | null;
  if (isSelfReportedIdentity(meta)) return false;
  return meta?.emailSource === SMTP_VERIFIED_EMAIL_SOURCE;
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
