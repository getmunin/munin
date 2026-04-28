import { Global, Module } from '@nestjs/common';
import { QuotasService } from './quotas.service.js';

@Global()
@Module({
  providers: [QuotasService],
  exports: [QuotasService],
})
export class QuotasModule {}
