import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { McpTool } from '@getmunin/mcp-toolkit';
import { ConnectorsService } from './connectors.service.ts';

const EmptyInput = z.object({});

const CreateConnectionInput = z.object({
  vendor: z.string().min(1).max(32),
  name: z.string().min(1).max(120),
  config: z.record(z.string(), z.unknown()),
});

const UpdateConnectionInput = z.object({
  connectionId: z.string().min(1),
  name: z.string().min(1).max(120).optional(),
  /** Full vendor config; secret fields may be omitted to keep the stored values. */
  config: z.record(z.string(), z.unknown()).optional(),
  active: z.boolean().optional(),
});

const ConnectionIdInput = z.object({
  connectionId: z.string().min(1),
});

@Injectable()
export class ConnectorAdminTools {
  constructor(@Inject(ConnectorsService) private readonly connectors: ConnectorsService) {}

  @McpTool({
    name: 'connectors_list_vendors',
    title: 'Connectors: List supported vendors',
    description:
      'List the third-party systems Munin can connect to, grouped by domain (commerce: Shopify, Magento 2; bookings: Gastroplanner) with the config fields each vendor requires. Use it to see what credentials are needed before creating a connection.',
    audiences: ['admin'],
    scopes: ['connectors:read'],
    input: EmptyInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  listVendors() {
    return { vendors: this.connectors.listVendors() };
  }

  @McpTool({
    name: 'connectors_list_connections',
    title: 'Connectors: List connections',
    description:
      'List this org’s connections to third-party systems with domain, non-secret settings, active state, and the result of the last credential test. Secrets are never returned.',
    audiences: ['admin'],
    scopes: ['connectors:read'],
    input: EmptyInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  async listConnections() {
    return { connections: await this.connectors.listConnections() };
  }

  @McpTool({
    name: 'connectors_create_connection',
    title: 'Connectors: Connect a system',
    description:
      'Create a connection to a third-party system. `config` is vendor-shaped (Shopify: shopDomain + accessToken; Magento: baseUrl + accessToken; Gastroplanner: apiToken). The vendor determines the domain (commerce, bookings). Secrets are encrypted at rest and never returned. Connection names must be unique within the org.',
    audiences: ['admin'],
    scopes: ['connectors:write'],
    input: CreateConnectionInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  createConnection(args: z.infer<typeof CreateConnectionInput>) {
    return this.connectors.createConnection(args);
  }

  @McpTool({
    name: 'connectors_update_connection',
    title: 'Connectors: Update a connection',
    description:
      'Rename, activate/deactivate, or reconfigure a connection. When passing `config`, supply the full vendor config; secret fields may be omitted to keep the stored values.',
    audiences: ['admin'],
    scopes: ['connectors:write'],
    input: UpdateConnectionInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  updateConnection(args: z.infer<typeof UpdateConnectionInput>) {
    return this.connectors.updateConnection(args);
  }

  @McpTool({
    name: 'connectors_delete_connection',
    title: 'Connectors: Delete a connection',
    description:
      'Delete a connection and its stored credentials. Lookups through this connection stop working immediately.',
    audiences: ['admin'],
    scopes: ['connectors:write'],
    input: ConnectionIdInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  deleteConnection(args: z.infer<typeof ConnectionIdInput>) {
    return this.connectors.deleteConnection(args);
  }

  @McpTool({
    name: 'connectors_test_connection',
    title: 'Connectors: Test a connection’s credentials',
    description:
      'Verify a connection’s stored credentials against the vendor with a read-only probe (no external data is changed). Records the result on the connection.',
    audiences: ['admin'],
    scopes: ['connectors:write'],
    input: ConnectionIdInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  testConnection(args: z.infer<typeof ConnectionIdInput>) {
    return this.connectors.testConnection(args);
  }
}
