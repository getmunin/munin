import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { SentryGlobalFilter, SentryModule } from '@sentry/nestjs/setup';
import {
  BACKEND_BASE_CONTROLLERS,
  BACKEND_BASE_PROVIDERS,
  BACKEND_FEATURE_MODULES_NO_AUTH,
  FeedbackModule,
  isFeedbackEnabled,
} from '@getmunin/backend-core';
import { AgentHostModule, SingletonConfigRepository } from '@getmunin/agent-host';
import { AuthModule } from './auth/auth.module.ts';

const FEEDBACK_MODULES = isFeedbackEnabled() ? [FeedbackModule] : [];

@Module({
  imports: [
    SentryModule.forRoot(),
    ...BACKEND_FEATURE_MODULES_NO_AUTH,
    AuthModule,
    AgentHostModule.forRoot({
      configRepository: SingletonConfigRepository,
    }),
    ...FEEDBACK_MODULES,
  ],
  controllers: BACKEND_BASE_CONTROLLERS,
  providers: [{ provide: APP_FILTER, useClass: SentryGlobalFilter }, ...BACKEND_BASE_PROVIDERS],
})
export class AppModule {}
