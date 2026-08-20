import { Module } from '@nestjs/common';
import { PublicThrottleModule } from '../../common/rate-limit/public-throttle.module.ts';
import { CredentialTargetRegistry } from './credential-target.ts';
import { CredentialHandoffService } from './credential-handoff.service.ts';
import { CredentialHandoffController } from './credential-handoff.controller.ts';

@Module({
  imports: [PublicThrottleModule],
  controllers: [CredentialHandoffController],
  providers: [
    { provide: CredentialTargetRegistry, useFactory: () => new CredentialTargetRegistry() },
    CredentialHandoffService,
  ],
  exports: [CredentialTargetRegistry, CredentialHandoffService],
})
export class CredentialHandoffModule {}
