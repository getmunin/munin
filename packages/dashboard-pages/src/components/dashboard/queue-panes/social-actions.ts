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

const MAX_INLINE_AUTHOR_CHARS = 12;

export function shortPublishName(displayName: string | null): string | null {
  const name = displayName?.trim().replace(/\s+/g, ' ');
  if (!name) return null;
  if (name.length <= MAX_INLINE_AUTHOR_CHARS) return name;
  const first = name.split(' ')[0]!;
  if (first.length <= MAX_INLINE_AUTHOR_CHARS) return first;
  return `${first.slice(0, MAX_INLINE_AUTHOR_CHARS - 1)}…`;
}
