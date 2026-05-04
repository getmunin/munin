import { Module } from '@nestjs/common';
import { DbListenerService } from './db-listener.service.js';
import { RealtimeGateway } from './realtime.gateway.js';

@Module({
  providers: [DbListenerService, RealtimeGateway],
  exports: [DbListenerService, RealtimeGateway],
})
export class RealtimeModule {}
