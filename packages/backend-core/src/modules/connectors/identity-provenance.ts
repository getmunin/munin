export type IdentityProvenance = 'authenticated' | 'channel_asserted' | 'self_reported';

export interface EndUserProvenanceMetadata {
  anonymous?: boolean;
  emailSource?: string;
}

const CHANNEL_ASSERTED_KINDS = new Set(['email', 'sms', 'voice']);

export const SENDER_AUTH_METADATA_KEY = 'senderAuth';
export const PROVEN_EMAIL_METADATA_KEY = 'provenEmail';
export const VISITOR_EMAIL_SOURCE = 'visitor';
export const ORG_ATTESTED_EMAIL_SOURCE = 'org-attested';
export const CHANNEL_EMAIL_SOURCE = 'channel';
export const LEGACY_EMAIL_SOURCE = 'legacy';

const TRUSTED_EMAIL_SOURCES: ReadonlySet<string> = new Set([
  ORG_ATTESTED_EMAIL_SOURCE,
  CHANNEL_EMAIL_SOURCE,
  LEGACY_EMAIL_SOURCE,
]);
export const ATTESTED_EMAIL_METADATA_KEY = 'attestedEmail';

export interface ConversationTurnMessage {
  authorType: string;
  metadata: unknown;
}

export function provenSenderMetadata(
  verdict: string,
  senderAddress: string,
): Record<string, string> {
  return verdict === 'pass'
    ? {
        [SENDER_AUTH_METADATA_KEY]: verdict,
        [PROVEN_EMAIL_METADATA_KEY]: senderAddress.trim().toLowerCase(),
      }
    : { [SENDER_AUTH_METADATA_KEY]: verdict };
}

export function isTrustedEmailSource(source: unknown): boolean {
  return typeof source === 'string' && TRUSTED_EMAIL_SOURCES.has(source);
}

export function isSelfReportedIdentity(identity: {
  email: string | null;
  metadata: unknown;
}): boolean {
  const meta = identity.metadata as EndUserProvenanceMetadata | null;
  if (meta?.anonymous === true) return true;
  if (!identity.email?.trim()) return false;
  return !isTrustedEmailSource(meta?.emailSource);
}

export function latestEndUserTurn<T extends { authorType: string }>(
  newestFirst: readonly T[],
): T[] {
  const turn: T[] = [];
  for (const message of newestFirst) {
    if (message.authorType === 'end_user') turn.push(message);
    else if (turn.length > 0) break;
  }
  return turn;
}

export type SenderAuthBlock = 'fail' | 'forwarded';

export function latestTurnSenderAuthBlock(
  newestFirst: readonly ConversationTurnMessage[],
): SenderAuthBlock | null {
  const verdicts = latestEndUserTurn(newestFirst).map(
    (message) =>
      (message.metadata as Record<string, unknown> | null)?.[SENDER_AUTH_METADATA_KEY],
  );
  if (verdicts.includes('fail')) return 'fail';
  if (verdicts.includes('forwarded')) return 'forwarded';
  return null;
}

export function identityProvenance(args: {
  channelType?: string | null;
  email: string | null;
  metadata: unknown;
}): IdentityProvenance {
  if (isSelfReportedIdentity(args)) return 'self_reported';
  const channel = args.channelType?.trim().toLowerCase();
  if (!channel) return 'channel_asserted';
  if (CHANNEL_ASSERTED_KINDS.has(channel)) return 'channel_asserted';
  if (channel === 'chat') return 'authenticated';
  return 'channel_asserted';
}
