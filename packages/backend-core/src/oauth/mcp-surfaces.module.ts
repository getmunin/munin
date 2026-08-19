import { Global, Module, type DynamicModule } from '@nestjs/common';
import { registerMcpResourcePaths } from '@getmunin/core';
import { ADDITIONAL_MCP_SURFACES, resolveMcpSurfaces, type McpSurface } from './mcp-surface.ts';

@Global()
@Module({})
export class McpSurfacesModule {
  static forRoot(surfaces: readonly McpSurface[]): DynamicModule {
    const resolved = resolveMcpSurfaces(surfaces);
    registerMcpResourcePaths(resolved.map((surface) => surface.path));
    return {
      module: McpSurfacesModule,
      providers: [{ provide: ADDITIONAL_MCP_SURFACES, useValue: resolved }],
      exports: [ADDITIONAL_MCP_SURFACES],
    };
  }
}
