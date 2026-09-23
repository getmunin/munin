export interface SocialPreviewDraft {
  platform: string;
  body: string;
  linkUrl: string | null;
  shareUrl: string | null;
  linkPlacement: string;
  linkCommentText: string | null;
  mediaUrl: string | null;
}

const FOLD_CHARS: Record<string, number> = { linkedin: 210, facebook: 477 };
const DEFAULT_FOLD_CHARS = 280;

export function previewLink(draft: SocialPreviewDraft): string | null {
  return draft.shareUrl ?? draft.linkUrl;
}

export interface SocialLinkPreview {
  linkUrl: string | null;
  readable: boolean;
  title: string | null;
  imageUrl: string | null;
}

export type PreviewPicture =
  | { kind: 'attached' }
  | { kind: 'pending' }
  | { kind: 'page'; imageUrl: string }
  | { kind: 'none'; readable: boolean };

export function previewPicture(
  draft: SocialPreviewDraft,
  linkPreview: SocialLinkPreview | null | undefined,
): PreviewPicture {
  if (draft.mediaUrl) return { kind: 'attached' };
  if (!draft.linkUrl) return { kind: 'none', readable: true };
  if (linkPreview === undefined) return { kind: 'pending' };
  if (linkPreview?.imageUrl) return { kind: 'page', imageUrl: linkPreview.imageUrl };
  return { kind: 'none', readable: linkPreview?.readable ?? false };
}

export function composePreviewBody(
  draft: SocialPreviewDraft,
  carriesPicture: boolean = draft.mediaUrl !== null,
): string {
  if (draft.linkPlacement === 'comment') return draft.body;
  if (draft.platform === 'facebook' && !carriesPicture) return draft.body;
  const link = previewLink(draft);
  if (!link || draft.body.includes(link)) return draft.body;
  return `${draft.body}\n\n${link}`;
}

export function composePreviewComment(draft: SocialPreviewDraft): string | null {
  if (draft.linkPlacement !== 'comment') return null;
  const link = previewLink(draft);
  if (!link) return null;
  const text = draft.linkCommentText?.trim() ?? '';
  if (!text) return link;
  if (text.includes(link)) return text;
  return `${text}\n\n${link}`;
}

export function foldPreviewBody(
  platform: string,
  text: string,
): { head: string; folded: boolean } {
  const limit = FOLD_CHARS[platform] ?? DEFAULT_FOLD_CHARS;
  if (text.length <= limit) return { head: text, folded: false };
  const cut = text.slice(0, limit);
  const lastBreak = cut.search(/\s\S*$/);
  const head = lastBreak > 0 ? cut.slice(0, lastBreak) : cut;
  return { head: head.trimEnd(), folded: true };
}

export function linkHost(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

const URL_PATTERN = /https?:\/\/[^\s<>"']+/g;

export function splitUrls(text: string): Array<{ text: string; url: boolean }> {
  const parts: Array<{ text: string; url: boolean }> = [];
  let cursor = 0;
  URL_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = URL_PATTERN.exec(text)) !== null) {
    if (match.index > cursor) parts.push({ text: text.slice(cursor, match.index), url: false });
    parts.push({ text: match[0], url: true });
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), url: false });
  return parts;
}

const LINK_COUNTS_TOWARD_BODY: Record<string, boolean> = { linkedin: false, facebook: true };

export function countBodyChars(platform: string, body: string): number {
  if (LINK_COUNTS_TOWARD_BODY[platform] ?? true) return body.length;
  const inline = body.match(URL_PATTERN) ?? [];
  return body.length - inline.reduce((total, link) => total + link.length, 0);
}
