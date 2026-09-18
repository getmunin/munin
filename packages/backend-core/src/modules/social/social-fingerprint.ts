import { createHash } from 'node:crypto';

export interface FingerprintableDraft {
  platform: string;
  body: string;
  linkUrl: string | null;
}

export function socialDraftFingerprint(draft: FingerprintableDraft): string {
  const canonical = JSON.stringify([draft.platform, draft.body, draft.linkUrl]);
  return createHash('sha256').update(canonical, 'utf8').digest('hex').slice(0, 32);
}
