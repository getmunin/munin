import { Get, NotFoundException, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { PublicController } from '../../common/auth/auth.guard.ts';
import {
  SLACK_AVATAR_FALLBACK_PNG,
  SLACK_AVATAR_FALLBACK_PNG_DARK,
  SLACK_AVATAR_PNGS,
  SLACK_AVATAR_PNGS_DARK,
} from './slack-avatars.generated.ts';

const FILE_RE = /^([A-Z]|default)(-dark)?\.png$/;

@PublicController('v1/slack/avatars')
export class SlackAvatarsController {
  @Get(':file')
  serve(@Param('file') file: string, @Res() res: Response): void {
    const match = FILE_RE.exec(file);
    if (!match) throw new NotFoundException();
    const key = match[1]!;
    const dark = match[2] === '-dark';
    const pngs = dark ? SLACK_AVATAR_PNGS_DARK : SLACK_AVATAR_PNGS;
    const fallback = dark ? SLACK_AVATAR_FALLBACK_PNG_DARK : SLACK_AVATAR_FALLBACK_PNG;
    const base64 = key === 'default' ? fallback : pngs[key];
    if (!base64) throw new NotFoundException();
    res
      .status(200)
      .setHeader('content-type', 'image/png')
      .setHeader('cache-control', 'public, max-age=31536000, immutable')
      .send(Buffer.from(base64, 'base64'));
  }
}
