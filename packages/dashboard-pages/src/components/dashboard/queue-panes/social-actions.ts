export interface SocialPublishTarget {
  userId: string;
  platform: string;
  authorKind: 'member' | 'org_page';
  externalAccountId: string;
  displayName: string | null;
}

export type SocialPublishAvailability =
  | { state: 'unsupported' }
  | { state: 'loading' }
  | { state: 'needsAccount' }
  | { state: 'ready'; authorName: string | null; authorKind: 'member' | 'org_page' };

export function socialPublishAvailability(
  draft: { canPublish: boolean; platform: string },
  targets: SocialPublishTarget[] | null | undefined,
): SocialPublishAvailability {
  if (!draft.canPublish) return { state: 'unsupported' };
  if (targets === undefined) return { state: 'loading' };
  const target = targets?.find((t) => t.platform === draft.platform);
  if (!target) return { state: 'needsAccount' };
  return { state: 'ready', authorName: target.displayName, authorKind: target.authorKind };
}

const MAX_INLINE_AUTHOR_CHARS = 12;

export function shortPublishName(
  displayName: string | null,
  authorKind: 'member' | 'org_page' = 'member',
): string | null {
  const name = displayName?.trim().replace(/\s+/g, ' ');
  if (!name) return null;
  if (name.length <= MAX_INLINE_AUTHOR_CHARS) return name;
  if (authorKind === 'org_page') return `${name.slice(0, MAX_INLINE_AUTHOR_CHARS - 1)}…`;
  const first = name.split(' ')[0]!;
  if (first.length <= MAX_INLINE_AUTHOR_CHARS) return first;
  return `${first.slice(0, MAX_INLINE_AUTHOR_CHARS - 1)}…`;
}

export function socialMediaKind(draft: {
  mediaKind: string | null;
  mediaUrl: string | null;
}): 'image' | 'video' | null {
  if (draft.mediaKind === 'image' || draft.mediaKind === 'video') return draft.mediaKind;
  if (!draft.mediaUrl) return null;
  return /\.(mp4|mov|m4v|webm)(\?|#|$)/i.test(draft.mediaUrl) ? 'video' : 'image';
}
