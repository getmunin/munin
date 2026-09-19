import { createHash } from 'node:crypto';

export interface FingerprintableDraft {
  platform: string;
  body: string;
  linkUrl: string | null;
  linkPlacement?: string;
  linkCommentText?: string | null;
  mediaUrl?: string | null;
}

export function socialDraftFingerprint(draft: FingerprintableDraft): string {
  const canonical = JSON.stringify([
    draft.platform,
    draft.body,
    draft.linkUrl,
    draft.linkPlacement ?? 'body',
    draft.linkCommentText ?? null,
    draft.mediaUrl ?? null,
  ]);
  return createHash('sha256').update(canonical, 'utf8').digest('hex').slice(0, 32);
}
