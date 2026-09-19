import { Injectable } from '@nestjs/common';
import type {
  SocialLinkPlacement,
  SocialMediaKind,
  SocialPlatform,
} from './social-platform.ts';

export interface SocialOAuthClient {
  clientId: string;
  clientSecret: string;
}

export interface SocialTokenSet {
  accessToken: string;
  expiresInSeconds?: number | undefined;
  refreshToken?: string | undefined;
  refreshTokenExpiresInSeconds?: number | undefined;
  scopes?: readonly string[] | undefined;
}

export interface SocialAccountIdentity {
  externalAccountId: string;
  displayName: string | null;
}

export interface SocialMediaUpload {
  kind: SocialMediaKind;
  bytes: Buffer;
  contentType: string;
  altText: string | null;
}

export interface SocialMediaRef {
  kind: SocialMediaKind;
  id: string;
  altText: string | null;
}

export interface SocialPublishRequest {
  accessToken: string;
  externalAccountId: string;
  body: string;
  linkUrl: string | null;
  linkPlacement: SocialLinkPlacement;
  linkCommentText: string | null;
  media: SocialMediaRef | null;
}

export interface SocialPublishResult {
  externalPostId: string;
  permalink: string | null;
  commentExternalId: string | null;
  commentError: string | null;
}

export class SocialGrantRevokedError extends Error {}

export interface SocialOAuthAdapter {
  readonly platform: SocialPlatform;
  readonly displayName: string;
  readonly authorizationScopes: readonly string[];
  authorizeUrl(args: { state: string; redirectUri: string; clientId: string }): string;
  exchangeCode(args: {
    code: string;
    redirectUri: string;
    client: SocialOAuthClient;
  }): Promise<SocialTokenSet>;
  refresh(args: { refreshToken: string; client: SocialOAuthClient }): Promise<SocialTokenSet>;
  identify(args: { accessToken: string }): Promise<SocialAccountIdentity>;
  publish?(args: SocialPublishRequest): Promise<SocialPublishResult>;
  uploadMedia?(args: {
    accessToken: string;
    externalAccountId: string;
    media: SocialMediaUpload;
  }): Promise<SocialMediaRef>;
}

@Injectable()
export class SocialOAuthRegistry {
  private readonly adapters = new Map<SocialPlatform, SocialOAuthAdapter>();

  register(adapter: SocialOAuthAdapter): void {
    this.adapters.set(adapter.platform, adapter);
  }

  get(platform: SocialPlatform): SocialOAuthAdapter | undefined {
    return this.adapters.get(platform);
  }

  platforms(): SocialPlatform[] {
    return [...this.adapters.keys()];
  }
}
