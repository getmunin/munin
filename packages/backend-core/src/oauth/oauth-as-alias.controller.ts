import { Controller, Get, Header, HttpException } from '@nestjs/common';
import { AllowAnonymous } from '../common/auth/auth.guard.js';
import { authorizationServerUrl } from './oauth.constants.js';

@Controller('.well-known/oauth-authorization-server')
export class OAuthAsAliasController {
  @Get()
  @AllowAnonymous()
  @Header('content-type', 'application/json; charset=utf-8')
  @Header('cache-control', 'public, max-age=300')
  async metadata(): Promise<unknown> {
    const upstream = `${authorizationServerUrl()}/auth/.well-known/openid-configuration`;
    const res = await fetch(upstream, {
      headers: { accept: 'application/json' },
    });
    if (!res.ok) {
      throw new HttpException(
        `authorization-server discovery upstream failed: ${res.status}`,
        502,
      );
    }
    return res.json();
  }
}
