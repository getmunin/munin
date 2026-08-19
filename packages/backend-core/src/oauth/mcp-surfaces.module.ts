import { Global, Module, type DynamicModule } from '@nestjs/common';
import { ADDITIONAL_MCP_SURFACES, resolveMcpSurfaces, type McpSurface } from './mcp-surface.ts';

@Global()
@Module({})
export class McpSurfacesModule {
  static forRoot(surfaces: readonly McpSurface[]): DynamicModule {
    const resolved = resolveMcpSurfaces(surfaces);
    return {
      module: McpSurfacesModule,
      providers: [{ provide: ADDITIONAL_MCP_SURFACES, useValue: resolved }],
      exports: [ADDITIONAL_MCP_SURFACES],
    };
  }
}
