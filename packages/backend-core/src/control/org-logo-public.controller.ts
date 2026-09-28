import { Get, NotFoundException, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { PublicController } from '../common/auth/auth.guard.ts';
import { OrgLogoService } from './org-logo.service.ts';

export const ORG_LOGO_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox";

@PublicController('v1/public/orgs', { throttle: true })
export class OrgLogoPublicController {
  constructor(private readonly logos: OrgLogoService) {}

  @Get(':orgId/logo')
  async serve(@Param('orgId') orgId: string, @Res() res: Response): Promise<void> {
    const logo = await this.logos.read(orgId);
    if (!logo) throw new NotFoundException();
    res.setHeader('Content-Type', logo.mime);
    res.setHeader('Content-Length', String(logo.bytes.length));
    res.setHeader('Content-Security-Policy', ORG_LOGO_CSP);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.status(200).end(logo.bytes);
  }
}
