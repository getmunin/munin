import { Module } from '@nestjs/common';
import { OAuthResourceController } from './oauth-resource.controller.js';

@Module({
  controllers: [OAuthResourceController],
})
export class OAuthModule {}
