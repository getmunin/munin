import { Module } from '@nestjs/common';
import { CredentialTargetRegistry } from './credential-target.ts';
import { CredentialHandoffService } from './credential-handoff.service.ts';
import { CredentialHandoffController } from './credential-handoff.controller.ts';

/**
 * Generic one-time credential handoff. Domain modules register a
 * CredentialTargetHandler into the registry; the public controller drives the
 * dashboard entry form. Owns no vendor knowledge.
 */
@Module({
  controllers: [CredentialHandoffController],
  providers: [
    { provide: CredentialTargetRegistry, useFactory: () => new CredentialTargetRegistry() },
    CredentialHandoffService,
  ],
  exports: [CredentialTargetRegistry, CredentialHandoffService],
})
export class CredentialHandoffModule {}
