import { Global, Module } from '@nestjs/common';
import { readAssetStorageFromEnv, type AssetStorage } from '@getmunin/core';
import { StaticAssetsController } from './static-assets.controller.ts';
import { STORAGE } from './storage.token.ts';

export { STORAGE } from './storage.token.ts';

@Global()
@Module({
  controllers: [StaticAssetsController],
  providers: [
    {
      provide: STORAGE,
      useFactory: (): AssetStorage => readAssetStorageFromEnv(),
    },
  ],
  exports: [STORAGE],
})
export class StorageModule {}
