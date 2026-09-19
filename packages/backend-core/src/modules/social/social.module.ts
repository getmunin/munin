import { Inject, Module, OnModuleInit } from '@nestjs/common';
import { WebhookDispatcher } from '@getmunin/core';
import { CuratorModule } from '../curator/curator.module.ts';
import { OutboundOAuthModule } from '../../common/outbound-oauth/outbound-oauth.module.ts';
import { SocialService } from './social.service.ts';
import { SocialTools } from './social.tools.ts';
import { SocialCompanionSink } from './social-companion.sink.ts';
import { SocialAccountsService } from './social-accounts.service.ts';
import { SocialOAuthRegistry } from './social-oauth.ts';
import { SocialOAuthController } from './social-oauth.controller.ts';
import { SocialExpiryWorker } from './social-expiry.worker.ts';
import { LinkedInAdapter } from './linkedin.adapter.ts';
import { SocialMediaFetcher } from './social-media.ts';
import { SocialAssetUsageProvider } from './social-asset-usage.provider.ts';
import { AssetUsageRegistry } from '../../common/asset-usage/asset-usage.registry.ts';

@Module({
  imports: [CuratorModule, OutboundOAuthModule],
  controllers: [SocialOAuthController],
  providers: [
    SocialService,
    SocialTools,
    SocialCompanionSink,
    SocialAccountsService,
    SocialOAuthRegistry,
    SocialExpiryWorker,
    LinkedInAdapter,
    SocialMediaFetcher,
    SocialAssetUsageProvider,
  ],
  exports: [SocialService, SocialAccountsService, SocialExpiryWorker],
})
export class SocialModule implements OnModuleInit {
  constructor(
    @Inject(WebhookDispatcher) private readonly dispatcher: WebhookDispatcher,
    @Inject(SocialCompanionSink) private readonly sink: SocialCompanionSink,
    @Inject(SocialOAuthRegistry) private readonly registry: SocialOAuthRegistry,
    @Inject(LinkedInAdapter) private readonly linkedin: LinkedInAdapter,
    @Inject(AssetUsageRegistry) private readonly assetUsage: AssetUsageRegistry,
    @Inject(SocialAssetUsageProvider) private readonly assetUsageProvider: SocialAssetUsageProvider,
  ) {}

  onModuleInit(): void {
    this.dispatcher.registerSink(this.sink);
    this.registry.register(this.linkedin);
    this.assetUsage.register(this.assetUsageProvider);
  }
}
