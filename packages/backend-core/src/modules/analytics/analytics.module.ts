import { Module } from '@nestjs/common';
import { AnalyticsService } from './analytics.service.ts';
import { AnalyticsAdminTools } from './analytics.tools.ts';

@Module({
  providers: [AnalyticsService, AnalyticsAdminTools],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
