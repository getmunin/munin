import { Module } from '@nestjs/common';
import { AddressDeliverabilityService } from './address-deliverability.service.ts';
import { CrmService } from './crm.service.ts';
import { CrmAdminTools } from './crm.tools.ts';
import { CrmSelfServiceTools } from './crm.self-service.tools.ts';

@Module({
  providers: [AddressDeliverabilityService, CrmService, CrmAdminTools, CrmSelfServiceTools],
  exports: [AddressDeliverabilityService, CrmService],
})
export class CrmModule {}
