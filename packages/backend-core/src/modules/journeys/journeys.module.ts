import { Module } from '@nestjs/common';
import { JourneysService } from './journeys.service.ts';
import { JourneysTools } from './journeys.tools.ts';

@Module({
  providers: [JourneysService, JourneysTools],
  exports: [JourneysService],
})
export class JourneysModule {}
