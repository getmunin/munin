import { Module } from '@nestjs/common';
import { CrmService } from './crm.service.js';
import { CrmAdminTools } from './crm.tools.js';
import { CrmSelfServiceTools } from './crm.self-service.tools.js';

@Module({
  providers: [CrmService, CrmAdminTools, CrmSelfServiceTools],
  exports: [CrmService],
})
export class CrmModule {}
