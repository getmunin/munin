import { Module } from '@nestjs/common';
import { CrmService } from './crm.service.ts';
import { CrmAdminTools } from './crm.tools.ts';
import { CrmSelfServiceTools } from './crm.self-service.tools.ts';

@Module({
  providers: [CrmService, CrmAdminTools, CrmSelfServiceTools],
  exports: [CrmService],
})
export class CrmModule {}
