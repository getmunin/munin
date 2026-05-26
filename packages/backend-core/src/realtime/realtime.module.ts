import { Module } from '@nestjs/common';
import { DbListenerService } from './db-listener.service.ts';
import { RealtimeEventBus } from './realtime-event-bus.ts';
import { RealtimeGateway } from './realtime.gateway.ts';

@Module({
  providers: [DbListenerService, RealtimeEventBus, RealtimeGateway],
  exports: [DbListenerService, RealtimeEventBus, RealtimeGateway],
})
export class RealtimeModule {}
