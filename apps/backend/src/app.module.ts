import { Module } from '@nestjs/common';
import {
  BACKEND_BASE_CONTROLLERS,
  BACKEND_BASE_PROVIDERS,
  BACKEND_FEATURE_MODULES_NO_AUTH,
} from '@getmunin/backend-core';
import { AuthModule } from './auth/auth.module.js';

@Module({
  imports: [...BACKEND_FEATURE_MODULES_NO_AUTH, AuthModule],
  controllers: BACKEND_BASE_CONTROLLERS,
  providers: BACKEND_BASE_PROVIDERS,
})
export class AppModule {}
