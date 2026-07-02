import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { McpTool } from '@getmunin/mcp-toolkit';
import { ALERT_SOURCES, AlertsService } from './system-alerts.service.ts';

const IdInput = z.object({ id: z.string() });

const ListInput = z.object({
  includeResolved: z.boolean().optional(),
  limit: z.number().int().min(1).max(200).optional(),
});

const ResolveInput = z.object({
  source: z.enum(ALERT_SOURCES),
  subjectId: z.string().nullable().optional(),
});

@Injectable()
export class SystemAlertsTools {
  constructor(@Inject(AlertsService) private readonly service: AlertsService) {}

  @McpTool({
    name: 'system_alerts_list',
    title: 'System alerts: List',
    description:
      'List operational alerts for the org. Defaults to open alerts only; pass includeResolved to see history.',
    audiences: ['admin'],
    scopes: ['system_alerts:read'],
    input: ListInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  async list(args: z.infer<typeof ListInput>) {
    return { items: await this.service.list(args) };
  }

  @McpTool({
    name: 'system_alerts_get',
    title: 'System alerts: Get',
    description: 'Read a single alert by id.',
    audiences: ['admin'],
    scopes: ['system_alerts:read'],
    input: IdInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  get(args: z.infer<typeof IdInput>) {
    return this.service.get(args.id);
  }

  @McpTool({
    name: 'system_alerts_acknowledge',
    title: 'System alerts: Acknowledge',
    description: 'Mark an alert as acknowledged. Does not resolve it; only signals that someone is on it.',
    audiences: ['admin'],
    scopes: ['system_alerts:write'],
    input: IdInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  acknowledge(args: z.infer<typeof IdInput>) {
    return this.service.acknowledgeAlert(args.id);
  }

  @McpTool({
    name: 'system_alerts_resolve',
    title: 'System alerts: Resolve',
    description:
      'Manually resolve the open alert for the given source+subject. Writers normally self-resolve; use this when the underlying state can no longer be observed.',
    audiences: ['admin'],
    scopes: ['system_alerts:write'],
    input: ResolveInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  resolve(args: z.infer<typeof ResolveInput>) {
    return this.service.resolveAlert({ source: args.source, subjectId: args.subjectId ?? null });
  }
}
