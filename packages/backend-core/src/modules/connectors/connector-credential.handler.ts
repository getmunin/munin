import { Inject, Injectable } from '@nestjs/common';
import { ConnectorsService } from './connectors.service.ts';
import type {
  CredentialApplyResult,
  CredentialTargetDescription,
  CredentialTargetHandler,
} from '../credential-handoff/credential-target.ts';

@Injectable()
export class ConnectorCredentialHandler implements CredentialTargetHandler {
  readonly targetType = 'connector';

  constructor(@Inject(ConnectorsService) private readonly connectors: ConnectorsService) {}

  describe(targetId: string): Promise<CredentialTargetDescription | null> {
    return this.connectors.describeCredentials(targetId);
  }

  apply(targetId: string, secrets: Record<string, string>): Promise<CredentialApplyResult> {
    return this.connectors.applyCredentials(targetId, secrets);
  }
}
