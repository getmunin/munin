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
import { AuditLogger, getCurrentContext, type Audience } from '@getmunin/core';
import { createMcpServer } from '@getmunin/mcp-toolkit';
import { AuthGuard } from '../common/auth/auth.guard.js';
import { TenancyInterceptor } from '../common/tenancy/tenancy.interceptor.js';
import { AuditInterceptor } from '../common/audit/audit.interceptor.js';
import { McpRegistryService } from './mcp.registry.js';
import { McpSkillRegistryService } from './mcp.skill-registry.service.js';
import { RateLimitService } from '../common/rate-limit/rate-limit.service.js';

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
@UseGuards(AuthGuard)
@UseInterceptors(TenancyInterceptor, AuditInterceptor)
export class McpController {
  private readonly audit = new AuditLogger();

  constructor(
    @Inject(McpRegistryService) private readonly registry: McpRegistryService,
    @Inject(McpSkillRegistryService) private readonly skills: McpSkillRegistryService,
    @Inject(RateLimitService) private readonly rateLimit: RateLimitService,
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

    // For now: admin agents see admin tools, end-user agents see self_service.
    // If a token has both audiences (rare; mainly admin keys), prefer 'admin'.
    const audience: Audience = actor.audiences.includes('admin') ? 'admin' : 'self_service';

    const server = createMcpServer({
      registry: this.registry,
      audience,
      actor,
      audit: this.audit,
      rateLimit: () => this.rateLimit.consume(),
      skills: this.skills,
      instructions: this.skills.instructions(),
    });

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless
      enableJsonResponse: true,
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body as unknown);
  }
}
