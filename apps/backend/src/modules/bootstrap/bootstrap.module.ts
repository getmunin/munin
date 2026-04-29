import { Module } from '@nestjs/common';
import { BootstrapRunner } from '@munin/bootstrap';
import { BootstrapTools } from './bootstrap.tools.js';
import { BootstrapRegistry } from './bootstrap.registry.js';
import { kbBootstrap } from '../kb/kb.bootstrap.js';
import { convBootstrap } from '../conv/conv.bootstrap.js';
import { crmBootstrap } from '../crm/crm.bootstrap.js';
import { cmsBootstrap } from '../cms/cms.bootstrap.js';

/**
 * The two universal bootstrap MCP tools live here. Each domain module
 * registers its BootstrapRunner via the shared BootstrapRegistry, and the
 * tools dispatch to the runner whose appKey the caller asked for.
 */
@Module({
  providers: [
    BootstrapTools,
    {
      provide: BootstrapRegistry,
      useFactory: (): BootstrapRegistry => {
        const reg = new BootstrapRegistry();
        const runners: BootstrapRunner[] = [kbBootstrap, convBootstrap, crmBootstrap, cmsBootstrap];
        for (const r of runners) reg.add(r);
        return reg;
      },
    },
  ],
})
export class BootstrapModule {}
