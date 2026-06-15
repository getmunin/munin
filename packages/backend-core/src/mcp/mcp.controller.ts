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
    return this.handle(req, res, true);
  }

  @Get()
  async get(@Req() req: Request, @Res() res: Response) {
    return this.handle(req, res, false);
  }

  @Delete()
  async del(@Req() req: Request, @Res() res: Response) {
    return this.handle(req, res, false);
  }

  private async handle(req: Request, res: Response, deferUntilCommit: boolean) {
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

    if (!deferUntilCommit) {
      await transport.handleRequest(req, res, req.body as unknown);
      return;
    }

    const captured = captureResponse(res);
    try {
      await transport.handleRequest(req, res, req.body as unknown);
    } finally {
      captured.restore();
    }
    if (ctx.afterCommit) {
      ctx.afterCommit.push(() => captured.flush());
    } else {
      captured.flush();
    }
  }
}

interface CapturedResponse {
  restore(): void;
  flush(): void;
}

function captureResponse(res: Response): CapturedResponse {
  const original = {
    writeHead: res.writeHead.bind(res),
    setHeader: res.setHeader.bind(res),
    write: res.write.bind(res),
    end: res.end.bind(res),
  };
  let statusCode = res.statusCode || 200;
  const headers = new Map<string, number | string | readonly string[]>();
  const chunks: Buffer[] = [];
  let endCallback: (() => void) | undefined;

  const toBuffer = (chunk: unknown, encoding?: unknown): Buffer | null => {
    if (chunk == null || typeof chunk === 'function') return null;
    if (Buffer.isBuffer(chunk)) return chunk;
    if (typeof chunk === 'string') {
      return Buffer.from(chunk, typeof encoding === 'string' ? (encoding as BufferEncoding) : 'utf8');
    }
    return Buffer.from(chunk as Uint8Array);
  };
  const mergeHeaders = (arg: unknown) => {
    if (!arg || typeof arg !== 'object') return;
    for (const [k, v] of Object.entries(arg as Record<string, number | string | readonly string[]>)) {
      headers.set(k, v);
    }
  };

  res.writeHead = function (this: Response, code: number, ...rest: unknown[]): Response {
    statusCode = code;
    for (const arg of rest) mergeHeaders(arg);
    return this;
  } as Response['writeHead'];

  res.setHeader = function (this: Response, name: string, value: number | string | readonly string[]): Response {
    headers.set(name, value);
    return this;
  } as Response['setHeader'];

  res.write = function (this: Response, chunk: unknown, encoding?: unknown, cb?: unknown): boolean {
    const buf = toBuffer(chunk, encoding);
    if (buf) chunks.push(buf);
    const callback = typeof encoding === 'function' ? encoding : cb;
    if (typeof callback === 'function') (callback as () => void)();
    return true;
  } as Response['write'];

  res.end = function (this: Response, chunk?: unknown, encoding?: unknown, cb?: unknown): Response {
    const buf = toBuffer(chunk, encoding);
    if (buf) chunks.push(buf);
    const callback =
      typeof chunk === 'function'
        ? chunk
        : typeof encoding === 'function'
        ? encoding
        : typeof cb === 'function'
        ? cb
        : undefined;
    if (typeof callback === 'function') endCallback = callback as () => void;
    return this;
  } as Response['end'];

  return {
    restore() {
      res.writeHead = original.writeHead;
      res.setHeader = original.setHeader;
      res.write = original.write;
      res.end = original.end;
    },
    flush() {
      if (res.headersSent || res.writableEnded) return;
      for (const [name, value] of headers) res.setHeader(name, value);
      res.writeHead(statusCode);
      res.end(Buffer.concat(chunks), endCallback);
    },
  };
}
