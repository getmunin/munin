import { Module } from '@nestjs/common';
import { PiiDataModule } from './pii-data.module.ts';
import { PiiWorkerController } from './pii-worker.controller.ts';
import { PiiWorkerGuard } from './pii-worker.guard.ts';
import { PiiCoverageMonitor } from './pii-coverage.monitor.ts';

@Module({
  imports: [PiiDataModule],
  controllers: [PiiWorkerController],
  providers: [PiiWorkerGuard, PiiCoverageMonitor],
  exports: [PiiDataModule],
})
export class PiiModule {}
