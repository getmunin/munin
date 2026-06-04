import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { McpController } from './mcp.controller.ts';
import { McpRegistryService } from './mcp.registry.ts';
import { McpSkillRegistryService } from './mcp.skill-registry.service.ts';
import { McpBurstGuard } from './mcp-burst.guard.ts';
import { PingMcpTool } from './ping.tool.ts';

@Module({
  imports: [DiscoveryModule],
  controllers: [McpController],
  providers: [McpRegistryService, McpSkillRegistryService, McpBurstGuard, PingMcpTool],
  exports: [McpRegistryService, McpSkillRegistryService],
})
export class McpModule {}
