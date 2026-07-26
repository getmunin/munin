import { Module } from '@nestjs/common';
import { CredentialTargetRegistry } from './credential-target.ts';
import { CredentialHandoffService } from './credential-handoff.service.ts';
import { CredentialHandoffController } from './credential-handoff.controller.ts';

@Module({
  controllers: [CredentialHandoffController],
  providers: [
    { provide: CredentialTargetRegistry, useFactory: () => new CredentialTargetRegistry() },
    CredentialHandoffService,
  ],
  exports: [CredentialTargetRegistry, CredentialHandoffService],
})
export class CredentialHandoffModule {}
