import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { McpTool } from '@getmunin/mcp-toolkit';
import { sensitive } from '@getmunin/types';
import { ConnectorsService } from './connectors.service.ts';

const EmptyInput = z.object({});

const CreateConnectionInput = z.object({
  vendor: z.string().min(1).max(32),
  name: z.string().min(1).max(120),
  config: sensitive(z.record(z.string(), z.unknown())).optional(),
});

const UpdateConnectionInput = z.object({
  connectionId: z.string().min(1),
  name: z.string().min(1).max(120).optional(),
  config: sensitive(z.record(z.string(), z.unknown())).optional(),
  active: z.boolean().optional(),
});

const ConnectionIdInput = z.object({
  connectionId: z.string().min(1),
});

const SetAllowedToolsInput = z.object({
  connectionId: z.string().min(1),
  toolNames: z.array(z.string().min(1).max(64)).max(20),
});

@Injectable()
export class ConnectorAdminTools {
  constructor(@Inject(ConnectorsService) private readonly connectors: ConnectorsService) {}

  @McpTool({
    name: 'connectors_list_vendors',
    title: 'Connectors: List supported vendors',
    description:
      'List the third-party systems Munin can connect to, grouped by domain (commerce, bookings) with the config fields each vendor requires. Use it to see what credentials are needed before creating a connection.',
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
    title: 'Connectors: Create a connection',
    description:
      'Create a connection to a third-party system. `config` takes the vendor’s non-secret fields only — connectors_list_vendors returns the exact fields and marks which are secret. Secret fields are rejected here: the connection is created pending and the response includes a one-time link for a human to enter the secrets in the dashboard. The vendor determines the domain (commerce, bookings, mcp). Connection names must be unique within the org. For the `custom-mcp` vendor the connected server is a customer-facing tool source, not a toolbox for admin agents: it exposes nothing until specific tool names are listed in its `allowedTools` config.',
    audiences: ['admin'],
    scopes: ['connectors:write'],
    input: CreateConnectionInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  createConnection(args: z.infer<typeof CreateConnectionInput>) {
    return this.connectors.createConnection(args, { rejectSecrets: true });
  }

  @McpTool({
    name: 'connectors_request_credentials',
    title: 'Connectors: Request a credential link',
    description:
      'Return a one-time link a human opens to enter a connection’s secret credentials in the dashboard, so the secret is never pasted into a conversation. Use it for a pending connection created without its secret. The link expires after 24 hours.',
    audiences: ['admin'],
    scopes: ['connectors:write'],
    input: ConnectionIdInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  requestCredentials(args: z.infer<typeof ConnectionIdInput>) {
    return this.connectors.requestCredentials(args);
  }

  @McpTool({
    name: 'connectors_update_connection',
    title: 'Connectors: Update a connection',
    description:
      'Rename, activate/deactivate, or reconfigure a connection. When passing `config`, supply the full non-secret vendor config; the stored secret values are kept. Secret fields are rejected here — to rotate a secret, delete the connection and create it again, entering the new secret through the credential link.',
    audiences: ['admin'],
    scopes: ['connectors:write'],
    input: UpdateConnectionInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  updateConnection(args: z.infer<typeof UpdateConnectionInput>) {
    return this.connectors.updateConnection(args, { rejectSecrets: true });
  }

  @McpTool({
    name: 'connectors_list_server_tools',
    title: 'Connectors: List a custom MCP server’s tools',
    description:
      'List the tools a connected custom MCP server offers, each flagged with whether it is currently exposed to customers (`allowed`) and whether the server marks it read-only (`destructive`). Use it to see what a server provides before choosing which tools customers may reach. Only applies to vendors with a selectable tool list, such as custom-mcp.',
    audiences: ['admin'],
    scopes: ['connectors:read'],
    input: ConnectionIdInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  listServerTools(args: z.infer<typeof ConnectionIdInput>) {
    return this.connectors.listSelectableTools(args);
  }

  @McpTool({
    name: 'connectors_set_allowed_tools',
    title: 'Connectors: Set which tools customers may use',
    description:
      'Replace the set of tools a connected custom MCP server exposes to customers. Pass the exact tool names from connectors_list_server_tools; anything omitted stops being offered. An empty list leaves the server connected but silent. Tools reach end-users in chat, email and SMS conversations, so list only what a customer should be able to call about themselves.',
    audiences: ['admin'],
    scopes: ['connectors:write'],
    input: SetAllowedToolsInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  setAllowedTools(args: z.infer<typeof SetAllowedToolsInput>) {
    return this.connectors.setAllowedTools(args);
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
