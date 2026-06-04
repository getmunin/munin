import { Module } from '@nestjs/common';
import { AnalyticsService } from './analytics.service.ts';

@Module({
  providers: [AnalyticsService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
