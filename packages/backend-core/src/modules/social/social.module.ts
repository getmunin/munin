import { Inject, Module, OnModuleInit } from '@nestjs/common';
import { WebhookDispatcher } from '@getmunin/core';
import { CuratorModule } from '../curator/curator.module.ts';
import { SocialService } from './social.service.ts';
import { SocialTools } from './social.tools.ts';
import { SocialCompanionSink } from './social-companion.sink.ts';

@Module({
  imports: [CuratorModule],
  providers: [SocialService, SocialTools, SocialCompanionSink],
  exports: [SocialService],
})
export class SocialModule implements OnModuleInit {
  constructor(
    @Inject(WebhookDispatcher) private readonly dispatcher: WebhookDispatcher,
    @Inject(SocialCompanionSink) private readonly sink: SocialCompanionSink,
  ) {}

  onModuleInit(): void {
    this.dispatcher.registerSink(this.sink);
  }
}
