import { Global, Module } from '@nestjs/common';
import { RateLimitService } from './rate-limit.service.ts';

@Global()
@Module({
  providers: [RateLimitService],
  exports: [RateLimitService],
})
export class RateLimitModule {}
