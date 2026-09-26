import { Module } from '@nestjs/common';
import { PiiDataModule } from './pii-data.module.ts';
import { PiiWorkerController } from './pii-worker.controller.ts';
import { PiiWorkerGuard } from './pii-worker.guard.ts';

@Module({
  imports: [PiiDataModule],
  controllers: [PiiWorkerController],
  providers: [PiiWorkerGuard],
  exports: [PiiDataModule],
})
export class PiiModule {}
