import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { McpController } from './mcp.controller.js';
import { McpRegistryService } from './mcp.registry.js';
import { McpSkillRegistryService } from './mcp.skill-registry.service.js';
import { PingMcpTool } from './ping.tool.js';

@Module({
  imports: [DiscoveryModule],
  controllers: [McpController],
  providers: [McpRegistryService, McpSkillRegistryService, PingMcpTool],
  exports: [McpRegistryService, McpSkillRegistryService],
})
export class McpModule {}
