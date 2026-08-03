import { createHash } from 'node:crypto';

export interface FingerprintableDraft {
  campaignId: string;
  contactId: string | null;
  kind: string;
  draftSubject: string | null;
  draftBody: string;
  proposedSendAt: Date | string | null;
}

export function draftFingerprint(draft: FingerprintableDraft): string {
  const sendAt =
    draft.proposedSendAt instanceof Date
      ? draft.proposedSendAt.toISOString()
      : (draft.proposedSendAt ?? null);
  const canonical = JSON.stringify([
    draft.campaignId,
    draft.contactId,
    draft.kind,
    draft.draftSubject,
    draft.draftBody,
    sendAt,
  ]);
  return createHash('sha256').update(canonical, 'utf8').digest('hex').slice(0, 32);
}
