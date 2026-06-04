import { Global, Module } from '@nestjs/common';
import { DefaultQuotasService, QUOTAS_SERVICE } from './quotas.service.ts';

@Global()
@Module({
  providers: [
    { provide: QUOTAS_SERVICE, useClass: DefaultQuotasService },
  ],
  exports: [QUOTAS_SERVICE],
})
export class QuotasModule {}
