import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { parseEnvInt } from '@getmunin/core';

@Module({
  imports: [
    ThrottlerModule.forRoot([
      {
        name: 'public-minute',
        ttl: 60_000,
        limit: parseEnvInt({ name: 'MUNIN_PUBLIC_THROTTLE_MIN', default: 60 }),
      },
      {
        name: 'public-hour',
        ttl: 60 * 60_000,
        limit: parseEnvInt({ name: 'MUNIN_PUBLIC_THROTTLE_HOUR', default: 1_000 }),
      },
    ]),
  ],
  exports: [ThrottlerModule],
})
export class PublicThrottleModule {}
