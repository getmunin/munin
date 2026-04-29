import { Global, Module } from '@nestjs/common';
import { readAssetStorageFromEnv, type AssetStorage } from '@getmunin/core';
import { StaticAssetsController } from './static-assets.controller.js';
import { STORAGE } from './storage.token.js';

export { STORAGE } from './storage.token.js';

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
