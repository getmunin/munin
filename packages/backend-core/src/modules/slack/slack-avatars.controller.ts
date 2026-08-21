import { createHash } from 'node:crypto';
import { Get, NotFoundException, Param, Res } from '@nestjs/common';
import { PublicController } from '../../common/auth/auth.guard.ts';
import {
  SLACK_AVATAR_FALLBACK_PNG,
  SLACK_AVATAR_FALLBACK_PNG_DARK,
  SLACK_AVATAR_PNGS,
  SLACK_AVATAR_PNGS_DARK,
} from './slack-avatars.generated.ts';

const FILE_RE = /^([A-Z]|default)(-dark)?(?:\.([0-9a-f]{8}))?\.png$/;

export interface AvatarResponse {
  status(code: number): AvatarResponse;
  setHeader(name: string, value: string): AvatarResponse;
  send(body: Buffer): unknown;
}

export function slackAvatarPng(avatarKey: string): string | null {
  const match = /^([A-Z]|default)(-dark)?$/.exec(avatarKey);
  if (!match) return null;
  const dark = match[2] === '-dark';
  const pngs = dark ? SLACK_AVATAR_PNGS_DARK : SLACK_AVATAR_PNGS;
  const fallback = dark ? SLACK_AVATAR_FALLBACK_PNG_DARK : SLACK_AVATAR_FALLBACK_PNG;
  return (match[1] === 'default' ? fallback : pngs[match[1]!]) ?? null;
}

export function slackAvatarFilename(avatarKey: string): string | null {
  const base64 = slackAvatarPng(avatarKey);
  if (!base64) return null;
  const digest = createHash('sha256').update(base64).digest('hex').slice(0, 8);
  return `${avatarKey}.${digest}.png`;
}

@PublicController('v1/slack/avatars')
export class SlackAvatarsController {
  @Get(':file')
  serve(@Param('file') file: string, @Res() res: AvatarResponse): void {
    const match = FILE_RE.exec(file);
    if (!match) throw new NotFoundException();
    const base64 = slackAvatarPng(`${match[1]!}${match[2] ?? ''}`);
    if (!base64) throw new NotFoundException();
    res
      .status(200)
      .setHeader('content-type', 'image/png')
      .setHeader('cache-control', 'public, max-age=31536000, immutable')
      .send(Buffer.from(base64, 'base64'));
  }
}
