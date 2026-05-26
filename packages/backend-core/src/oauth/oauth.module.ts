import { Module } from '@nestjs/common';
import { OAuthAsAliasController } from './oauth-as-alias.controller.ts';
import { OAuthClientInfoController } from './oauth-client-info.controller.ts';
import { OAuthResourceController } from './oauth-resource.controller.ts';

@Module({
  controllers: [
    OAuthResourceController,
    OAuthAsAliasController,
    OAuthClientInfoController,
  ],
})
export class OAuthModule {}
