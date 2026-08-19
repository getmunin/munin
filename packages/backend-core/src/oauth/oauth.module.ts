import { Module } from '@nestjs/common';
import { OAuthAsAliasController } from './oauth-as-alias.controller.ts';
import { OAuthClientInfoController } from './oauth-client-info.controller.ts';
import { OAuthPendingOrgController } from './oauth-pending-org.controller.ts';
import { OAuthResourceController } from './oauth-resource.controller.ts';

@Module({
  controllers: [
    OAuthResourceController,
    OAuthAsAliasController,
    OAuthClientInfoController,
    OAuthPendingOrgController,
  ],
})
export class OAuthModule {}
