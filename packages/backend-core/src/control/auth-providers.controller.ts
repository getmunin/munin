import { Get } from '@nestjs/common';
import { PublicController } from '../common/auth/auth.guard.ts';
import {
  readGithubProviderFromEnv,
  readGoogleProviderFromEnv,
  readTurnstileCaptchaFromEnv,
} from '../auth-env.ts';

interface AuthProvidersResponse {
  google: boolean;
  github: boolean;
  captcha?: { provider: 'cloudflare-turnstile'; siteKey: string };
}

@PublicController('v1/auth/providers', { throttle: true })
export class AuthProvidersController {
  @Get()
  list(): AuthProvidersResponse {
    const captcha = readTurnstileCaptchaFromEnv();
    return {
      google: readGoogleProviderFromEnv() !== undefined,
      github: readGithubProviderFromEnv() !== undefined,
      ...(captcha ? { captcha: { provider: captcha.provider, siteKey: captcha.siteKey } } : {}),
    };
  }
}
