import { Global, Module } from '@nestjs/common';
import { IdentityService } from './identity.service.ts';
import { IdentityTools } from './identity.tools.ts';

@Global()
@Module({
  providers: [IdentityService, IdentityTools],
  exports: [IdentityService],
})
export class IdentityModule {}
