import { Controller, Get, UseGuards } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AllowAnonymous } from '../common/auth/auth.guard.ts';
import {
  readGithubProviderFromEnv,
  readGoogleProviderFromEnv,
} from '../auth-env.ts';

interface AuthProvidersResponse {
  google: boolean;
  github: boolean;
}

@Controller('v1/auth/providers')
@AllowAnonymous()
@UseGuards(ThrottlerGuard)
export class AuthProvidersController {
  @Get()
  list(): AuthProvidersResponse {
    return {
      google: readGoogleProviderFromEnv() !== undefined,
      github: readGithubProviderFromEnv() !== undefined,
    };
  }
}
