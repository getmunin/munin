import { Module } from '@nestjs/common';
import { DbListenerService } from './db-listener.service.js';
import { RealtimeEventBus } from './realtime-event-bus.js';
import { RealtimeGateway } from './realtime.gateway.js';

@Module({
  providers: [DbListenerService, RealtimeEventBus, RealtimeGateway],
  exports: [DbListenerService, RealtimeEventBus, RealtimeGateway],
})
export class RealtimeModule {}
