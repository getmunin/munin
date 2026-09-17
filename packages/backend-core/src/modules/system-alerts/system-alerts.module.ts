import { Global, Module, OnModuleInit } from '@nestjs/common';
import { WebhookDispatcher } from '@getmunin/core';
import { AlertsService } from './system-alerts.service.ts';
import { SystemAlertsController } from './system-alerts.controller.ts';
import { SystemAlertsTools } from './system-alerts.tools.ts';
import { AlertNotificationSink } from './alert-notification.sink.ts';
import { AlertNotificationWorker } from './alert-notification.worker.ts';

@Global()
@Module({
  controllers: [SystemAlertsController],
  providers: [AlertsService, SystemAlertsTools, AlertNotificationSink, AlertNotificationWorker],
  exports: [AlertsService, AlertNotificationWorker],
})
export class SystemAlertsModule implements OnModuleInit {
  constructor(
    private readonly dispatcher: WebhookDispatcher,
    private readonly sink: AlertNotificationSink,
  ) {}

  onModuleInit(): void {
    this.dispatcher.registerSink(this.sink);
  }
}
