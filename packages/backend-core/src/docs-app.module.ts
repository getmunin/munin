import { Module } from '@nestjs/common';
import {
  BACKEND_FEATURE_MODULES,
  BACKEND_BASE_CONTROLLERS,
  BACKEND_BASE_PROVIDERS,
} from './app.module.ts';
import { FeedbackModule } from './modules/feedback/feedback.module.ts';

@Module({
  imports: [...BACKEND_FEATURE_MODULES, FeedbackModule],
  controllers: BACKEND_BASE_CONTROLLERS,
  providers: BACKEND_BASE_PROVIDERS,
})
export class DocsAppModule {}
