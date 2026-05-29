import { Global, Module } from '@nestjs/common';
import { CallQuotaInterceptor } from './call-quota.interceptor.ts';
import { DefaultQuotasService, QUOTAS_SERVICE } from './quotas.service.ts';

@Global()
@Module({
  providers: [
    { provide: QUOTAS_SERVICE, useClass: DefaultQuotasService },
    CallQuotaInterceptor,
  ],
  exports: [QUOTAS_SERVICE, CallQuotaInterceptor],
})
export class QuotasModule {}
