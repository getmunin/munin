import { Global, Module } from '@nestjs/common';
import { PiiAnnotationsService } from './pii-annotations.service.ts';
import { PiiWorkerController } from './pii-worker.controller.ts';
import { PiiWorkerGuard } from './pii-worker.guard.ts';

@Global()
@Module({
  controllers: [PiiWorkerController],
  providers: [PiiAnnotationsService, PiiWorkerGuard],
  exports: [PiiAnnotationsService],
})
export class PiiModule {}
