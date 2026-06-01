import { Get } from '@nestjs/common';
import { PublicController } from './auth/auth.guard.ts';

@PublicController('')
export class HealthController {
  @Get('healthz')
  healthz() {
    return { ok: true };
  }

  @Get('readyz')
  readyz() {
    return { ok: true };
  }

  @Get('version')
  version() {
    return { version: process.env.MUNIN_VERSION ?? '0.0.1' };
  }
}
