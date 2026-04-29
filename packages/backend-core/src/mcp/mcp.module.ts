import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { McpController } from './mcp.controller.js';
import { McpRegistryService } from './mcp.registry.js';
import { PingMcpTool } from './ping.tool.js';

/**
 * Wires the MCP transport, the @McpTool registry, and any service that
 * declares MCP tools. Domain modules (kb, desk, crm) will register their
 * own services here as they land.
 */
@Module({
  imports: [DiscoveryModule],
  controllers: [McpController],
  providers: [McpRegistryService, PingMcpTool],
  exports: [McpRegistryService],
})
export class McpModule {}
