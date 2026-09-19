import { Global, Module } from '@nestjs/common';
import { AssetUsageRegistry } from './asset-usage.registry.ts';

@Global()
@Module({
  providers: [
    {
      provide: AssetUsageRegistry,
      useFactory: () => new AssetUsageRegistry(),
    },
  ],
  exports: [AssetUsageRegistry],
})
export class AssetUsageModule {}
