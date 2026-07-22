import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { SLACK_AVATAR_FALLBACK_PNG, SLACK_AVATAR_PNGS } from './slack-avatars.generated.ts';

const FILE_RE = /^([A-Z0-9]|default)\.png$/;

@Controller('v1/slack/avatars')
export class SlackAvatarsController {
  @Get(':file')
  serve(@Param('file') file: string, @Res() res: Response): void {
    const match = FILE_RE.exec(file);
    if (!match) throw new NotFoundException();
    const base64 =
      match[1] === 'default' ? SLACK_AVATAR_FALLBACK_PNG : SLACK_AVATAR_PNGS[match[1]!];
    if (!base64) throw new NotFoundException();
    res
      .status(200)
      .setHeader('content-type', 'image/png')
      .setHeader('cache-control', 'public, max-age=31536000, immutable')
      .send(Buffer.from(base64, 'base64'));
  }
}
