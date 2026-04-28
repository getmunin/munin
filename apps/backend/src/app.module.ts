import { Module } from '@nestjs/common';
import { HealthController } from './common/health.controller.js';

/**
 * Root module. In M0 we wire only the health endpoint to confirm the
 * deployment pipe end-to-end. Domain modules (kb, desk, crm) and the
 * MCP / OAuth / control modules are added in subsequent milestones.
 */
@Module({
  imports: [],
  controllers: [HealthController],
  providers: [],
})
export class AppModule {}
