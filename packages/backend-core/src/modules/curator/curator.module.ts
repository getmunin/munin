import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { CuratorJobsService } from './curator-jobs.service.ts';
import { CuratorSchedulerService } from './curator-scheduler.service.ts';

@Module({
  imports: [ScheduleModule.forRoot()],
  providers: [CuratorJobsService, CuratorSchedulerService],
  exports: [CuratorJobsService],
})
export class CuratorModule {}
