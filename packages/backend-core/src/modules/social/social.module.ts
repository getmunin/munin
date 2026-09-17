import { Module } from '@nestjs/common';
import { SocialService } from './social.service.ts';
import { SocialTools } from './social.tools.ts';

@Module({
  providers: [SocialService, SocialTools],
  exports: [SocialService],
})
export class SocialModule {}
