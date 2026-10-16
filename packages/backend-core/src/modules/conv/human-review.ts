export const APPROVED_OUTREACH_PROPOSAL_KEY = 'approvedOutreachProposalId';

export interface ReviewableMessage {
  authorType: string;
  metadata: unknown;
}

export function isWrittenOrApprovedByPerson(message: ReviewableMessage): boolean {
  if (message.authorType === 'user') return true;
  const meta = message.metadata as Record<string, unknown> | null;
  return typeof meta?.[APPROVED_OUTREACH_PROPOSAL_KEY] === 'string';
}
