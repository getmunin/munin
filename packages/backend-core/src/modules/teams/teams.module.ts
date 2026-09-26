import { Inject, Module, OnModuleInit } from '@nestjs/common';
import { WebhookDispatcher } from '@getmunin/core';
import { PublicThrottleModule } from '../../common/rate-limit/public-throttle.module.ts';
import { ConvModule } from '../conv/conv.module.ts';
import { CredentialHandoffModule } from '../credential-handoff/credential-handoff.module.ts';
import { CredentialTargetRegistry } from '../credential-handoff/credential-target.ts';
import { TeamsApiClient } from './teams-api.client.ts';
import { BotFrameworkKeyStore } from './teams-auth.ts';
import { TeamsBridgeWorker } from './teams-bridge.worker.ts';
import { TeamsEventSink } from './teams-event-sink.ts';
import { TeamsInboundService } from './teams-inbound.service.ts';
import { TeamsInteractionsService } from './teams-interactions.service.ts';
import { TeamsMessagesController } from './teams-messages.controller.ts';
import { TeamsUserMappingService } from './teams-user-mapping.service.ts';
import { TeamsService } from './teams.service.ts';
import { TeamsAdminTools } from './teams.tools.ts';

@Module({
  imports: [ConvModule, CredentialHandoffModule, PublicThrottleModule],
  providers: [
    TeamsApiClient,
    BotFrameworkKeyStore,
    TeamsService,
    TeamsEventSink,
    TeamsBridgeWorker,
    TeamsInboundService,
    TeamsInteractionsService,
    TeamsUserMappingService,
    TeamsAdminTools,
  ],
  controllers: [TeamsMessagesController],
  exports: [TeamsService],
})
export class TeamsModule implements OnModuleInit {
  constructor(
    @Inject(WebhookDispatcher) private readonly dispatcher: WebhookDispatcher,
    @Inject(TeamsEventSink) private readonly sink: TeamsEventSink,
    @Inject(CredentialTargetRegistry) private readonly credentialTargets: CredentialTargetRegistry,
    @Inject(TeamsService) private readonly teams: TeamsService,
  ) {}

  onModuleInit(): void {
    this.dispatcher.registerSink(this.sink);
    this.credentialTargets.register(this.teams);
  }
}
