export interface SocialPublishTarget {
  userId: string;
  externalAccountId: string;
  displayName: string | null;
}

export type SocialPublishAvailability =
  | { state: 'unsupported' }
  | { state: 'loading' }
  | { state: 'needsAccount' }
  | { state: 'ready'; authorName: string | null };

export function socialPublishAvailability(
  draft: { canPublish: boolean },
  target: SocialPublishTarget | null | undefined,
): SocialPublishAvailability {
  if (!draft.canPublish) return { state: 'unsupported' };
  if (target === undefined) return { state: 'loading' };
  if (target === null) return { state: 'needsAccount' };
  return { state: 'ready', authorName: target.displayName };
}
