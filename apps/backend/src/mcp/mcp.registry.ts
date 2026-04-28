import { Injectable, OnModuleInit, type Type } from '@nestjs/common';
import { DiscoveryService, MetadataScanner, ModuleRef } from '@nestjs/core';
import { McpToolRegistry, MCP_TOOL_META, type McpToolMeta } from '@munin/mcp-toolkit';

/**
 * Walks every NestJS provider at boot and registers every method that
 * carries @McpTool metadata. The bound handler is the method with `this`
 * fixed to the provider instance.
 */
@Injectable()
export class McpRegistryService extends McpToolRegistry implements OnModuleInit {
  constructor(
    private readonly discovery: DiscoveryService,
    private readonly metadataScanner: MetadataScanner,
    private readonly moduleRef: ModuleRef,
  ) {
    super();
  }

  onModuleInit() {
    const providers = this.discovery.getProviders();
    for (const wrapper of providers) {
      const instance = wrapper.instance as Record<string, unknown> | null;
      if (!instance || typeof instance !== 'object') continue;
      const proto = Object.getPrototypeOf(instance) as object;
      if (!proto) continue;

      const methodNames = this.metadataScanner.getAllMethodNames(proto);
      for (const methodName of methodNames) {
        const meta = Reflect.getMetadata(MCP_TOOL_META, proto, methodName) as
          | McpToolMeta
          | undefined;
        if (!meta) continue;
        const fn = instance[methodName];
        if (typeof fn !== 'function') continue;
        this.register(meta, (args) => (fn as (a: unknown) => unknown).call(instance, args));
      }
    }
  }
}

/** Re-export for typing convenience in modules that wire MCP services. */
export type { Type };
