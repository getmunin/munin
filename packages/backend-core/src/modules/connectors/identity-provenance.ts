export type IdentityProvenance = 'authenticated' | 'channel_asserted' | 'self_reported';

export interface EndUserProvenanceMetadata {
  anonymous?: boolean;
  emailSource?: string;
}

const CHANNEL_ASSERTED_KINDS = new Set(['email', 'sms', 'voice']);

export const SENDER_AUTH_METADATA_KEY = 'senderAuth';

export interface ConversationTurnMessage {
  authorType: string;
  authorEmail: string | null;
  metadata: unknown;
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

export function isProvenEmailTurn(
  newestFirst: readonly ConversationTurnMessage[],
  email: string,
): boolean {
  const turn = latestEndUserTurn(newestFirst);
  if (turn.length === 0) return false;
  const expected = email.trim().toLowerCase();
  return turn.every((message) => {
    const meta = message.metadata as Record<string, unknown> | null;
    return (
      meta?.[SENDER_AUTH_METADATA_KEY] === 'pass' &&
      message.authorEmail?.trim().toLowerCase() === expected
    );
  });
}

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
