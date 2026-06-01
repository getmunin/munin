import { Get } from '@nestjs/common';
import { PublicController } from '../common/auth/auth.guard.ts';
import {
  readGithubProviderFromEnv,
  readGoogleProviderFromEnv,
} from '../auth-env.ts';

interface AuthProvidersResponse {
  google: boolean;
  github: boolean;
}

@PublicController('v1/auth/providers', { throttle: true })
export class AuthProvidersController {
  @Get()
  list(): AuthProvidersResponse {
    return {
      google: readGoogleProviderFromEnv() !== undefined,
      github: readGithubProviderFromEnv() !== undefined,
    };
  }
}
