import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { McpController } from './mcp.controller.js';
import { McpRegistryService } from './mcp.registry.js';
import { McpRunbookRegistryService } from './mcp.runbook-registry.service.js';
import { PingMcpTool } from './ping.tool.js';

@Module({
  imports: [DiscoveryModule],
  controllers: [McpController],
  providers: [McpRegistryService, McpRunbookRegistryService, PingMcpTool],
  exports: [McpRegistryService, McpRunbookRegistryService],
})
export class McpModule {}
