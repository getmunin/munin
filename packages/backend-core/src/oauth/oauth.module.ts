import { Module } from '@nestjs/common';
import { OAuthAsAliasController } from './oauth-as-alias.controller.js';
import { OAuthResourceController } from './oauth-resource.controller.js';

@Module({
  controllers: [OAuthResourceController, OAuthAsAliasController],
})
export class OAuthModule {}
