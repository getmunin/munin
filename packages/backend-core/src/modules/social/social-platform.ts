export const SOCIAL_PLATFORMS = ['linkedin'] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

export const SOCIAL_AUTHOR_KINDS = ['member', 'org_page'] as const;
export type SocialAuthorKind = (typeof SOCIAL_AUTHOR_KINDS)[number];

export const SOCIAL_DRAFT_STATUSES = [
  'pending',
  'published',
  'published_externally',
  'dismissed',
  'failed',
] as const;
export type SocialDraftStatus = (typeof SOCIAL_DRAFT_STATUSES)[number];

export interface SocialPostLimits {
  maxBodyChars: number;
  maxLinks: number;
  maxImages: number;
  linkCountsTowardBody: boolean;
}

export interface SocialPlatformDescriptor {
  readonly platform: SocialPlatform;
  readonly displayName: string;
  readonly authorKinds: readonly SocialAuthorKind[];
  readonly limits: SocialPostLimits;
  readonly composerUrl: string;
  readonly utmSource: string;
}

export const SOCIAL_PLATFORM_DESCRIPTORS: Record<SocialPlatform, SocialPlatformDescriptor> = {
  linkedin: {
    platform: 'linkedin',
    displayName: 'LinkedIn',
    authorKinds: ['member', 'org_page'],
    limits: {
      maxBodyChars: 3000,
      maxLinks: 1,
      maxImages: 1,
      linkCountsTowardBody: false,
    },
    composerUrl: 'https://www.linkedin.com/feed/?shareActive=true',
    utmSource: 'linkedin',
  },
};

export function isSocialPlatform(value: string): value is SocialPlatform {
  return (SOCIAL_PLATFORMS as readonly string[]).includes(value);
}

export function describePlatform(platform: SocialPlatform): SocialPlatformDescriptor {
  return SOCIAL_PLATFORM_DESCRIPTORS[platform];
}

export interface SocialBodyMeasurement {
  bodyChars: number;
  countedChars: number;
  maxBodyChars: number;
  overBy: number;
  linkCount: number;
  maxLinks: number;
}

const URL_PATTERN = /https?:\/\/[^\s<>"']+/g;

export function measureBody(
  platform: SocialPlatform,
  body: string,
  linkUrl: string | null,
): SocialBodyMeasurement {
  const limits = describePlatform(platform).limits;
  const inlineLinks = body.match(URL_PATTERN) ?? [];
  const linkCount = inlineLinks.length + (linkUrl ? 1 : 0);
  const inlineLinkChars = inlineLinks.reduce((total, link) => total + link.length, 0);
  const countedChars = limits.linkCountsTowardBody
    ? body.length
    : body.length - inlineLinkChars;
  return {
    bodyChars: body.length,
    countedChars,
    maxBodyChars: limits.maxBodyChars,
    overBy: Math.max(0, countedChars - limits.maxBodyChars),
    linkCount,
    maxLinks: limits.maxLinks,
  };
}

export interface UtmParams {
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  utm_content: string;
}

export function buildUtm(
  platform: SocialPlatform,
  setId: string,
  variantLabel: string,
): UtmParams {
  return {
    utm_source: describePlatform(platform).utmSource,
    utm_medium: 'social',
    utm_campaign: setId,
    utm_content: variantLabel,
  };
}

export function applyUtm(linkUrl: string, utm: UtmParams): string {
  const url = new URL(linkUrl);
  url.searchParams.set('utm_source', utm.utm_source);
  url.searchParams.set('utm_medium', utm.utm_medium);
  url.searchParams.set('utm_campaign', utm.utm_campaign);
  url.searchParams.set('utm_content', utm.utm_content);
  return url.toString();
}
