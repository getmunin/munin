import {
  Controller,
  Post,
  Get,
  Delete,
  Req,
  Res,
  UseGuards,
  UseInterceptors,
  Inject,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { AuditLogger, getCurrentContext } from '@getmunin/core';
import { createMcpServer } from '@getmunin/mcp-toolkit';
import { AuthGuard } from '../common/auth/auth.guard.ts';
import { TenancyInterceptor } from '../common/tenancy/tenancy.interceptor.ts';
import { AuditInterceptor } from '../common/audit/audit.interceptor.ts';
import { McpRegistryService } from './mcp.registry.ts';
import { McpSkillRegistryService } from './mcp.skill-registry.service.ts';
import { McpBurstGuard } from './mcp-burst.guard.ts';
import { RateLimitService } from '../common/rate-limit/rate-limit.service.ts';
import { QUOTAS_SERVICE, type QuotasService } from '../common/quotas/quotas.service.ts';
import {
  ERROR_REPORTER,
  type ErrorReporter,
} from '../common/error-reporter/error-reporter.ts';
import { deriveMcpAudience } from './mcp.audience.ts';
import { mcpResourceOrigin } from '../oauth/oauth.constants.ts';

/**
 * Streamable HTTP entry point for the MCP server.
 *
 * Stateless mode: each POST request constructs a fresh Server + transport,
 * processes the JSON-RPC payload, and tears down. This way each call is
 * audience-filtered to exactly the authenticated actor and there's no
 * cross-session state to lose.
 *
 * GET is used for SSE streaming; DELETE terminates a session id when the
 * SDK exposes one (currently a no-op for stateless mode).
 */
@Controller('mcp')
@UseGuards(AuthGuard, McpBurstGuard)
@UseInterceptors(TenancyInterceptor, AuditInterceptor)
export class McpController {
  private readonly audit = new AuditLogger();

  constructor(
    @Inject(McpRegistryService) private readonly registry: McpRegistryService,
    @Inject(McpSkillRegistryService) private readonly skills: McpSkillRegistryService,
    @Inject(RateLimitService) private readonly rateLimit: RateLimitService,
    @Inject(QUOTAS_SERVICE) private readonly quotas: QuotasService,
    @Inject(ERROR_REPORTER) private readonly errorReporter: ErrorReporter,
  ) {}

  @Post()
  async post(@Req() req: Request, @Res() res: Response) {
    return this.handle(req, res);
  }

  @Get()
  async get(@Req() req: Request, @Res() res: Response) {
    return this.handle(req, res);
  }

  @Delete()
  async del(@Req() req: Request, @Res() res: Response) {
    return this.handle(req, res);
  }

  private async handle(req: Request, res: Response) {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;

    const audience = deriveMcpAudience(actor);

    const server = createMcpServer({
      registry: this.registry,
      audience,
      actor,
      audit: this.audit,
      rateLimit: async (toolName: string) => {
        await this.rateLimit.consume();
        await this.quotas.recordCall('mcp_tool', toolName);
      },
      skills: this.skills,
      apiBaseUrl: mcpResourceOrigin(),
      instructions: this.skills.instructions(),
      captureException: (error, context) => this.errorReporter.captureException(error, context),
    });

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless
      enableJsonResponse: true,
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body as unknown);
  }
}
