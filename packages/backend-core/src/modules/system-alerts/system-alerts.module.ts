import { Global, Module } from '@nestjs/common';
import { AlertsService } from './system-alerts.service.ts';
import { SystemAlertsController } from './system-alerts.controller.ts';
import { SystemAlertsTools } from './system-alerts.tools.ts';

@Global()
@Module({
  controllers: [SystemAlertsController],
  providers: [AlertsService, SystemAlertsTools],
  exports: [AlertsService],
})
export class SystemAlertsModule {}
