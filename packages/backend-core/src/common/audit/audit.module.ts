import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AuditRetentionService } from './audit-retention.service.ts';

@Module({
  imports: [ScheduleModule.forRoot()],
  providers: [AuditRetentionService],
})
export class AuditModule {}
