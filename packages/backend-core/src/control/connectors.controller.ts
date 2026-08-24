import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { AuthGuard } from '../common/auth/auth.guard.ts';
import { ControlPlaneGuard } from '../common/auth/control-plane.guard.ts';
import { TenancyInterceptor } from '../common/tenancy/tenancy.interceptor.ts';
import { AuditInterceptor } from '../common/audit/audit.interceptor.ts';
import { RoleGuard } from './role.guard.ts';
import { RequireRole } from './role.decorator.ts';
import { ConnectorsService } from '../modules/connectors/connectors.service.ts';

class CreateConnectionBody extends createZodDto(
  z.object({
    vendor: z.string().min(1).max(32),
    name: z.string().min(1).max(120),
    config: z.record(z.string(), z.unknown()).optional(),
  }),
) {}

class UpdateConnectionBody extends createZodDto(
  z.object({
    name: z.string().min(1).max(120).optional(),
    config: z.record(z.string(), z.unknown()).optional(),
    active: z.boolean().optional(),
  }),
) {}

class SetAllowedToolsBody extends createZodDto(
  z.object({
    toolNames: z.array(z.string().min(1).max(64)).max(20),
  }),
) {}

class ApplyConnectionCredentialsBody extends createZodDto(
  z.object({
    secrets: z.record(z.string(), z.string().min(1)),
  }),
) {}

@Controller('v1/connectors')
@UseGuards(AuthGuard, ControlPlaneGuard, RoleGuard)
@UseInterceptors(TenancyInterceptor, AuditInterceptor)
@RequireRole('owner', 'admin')
export class ConnectorsController {
  constructor(private readonly connectors: ConnectorsService) {}

  @Get('vendors')
  listVendors() {
    return { vendors: this.connectors.listVendors() };
  }

  @Get()
  async list() {
    return { connections: await this.connectors.listConnections() };
  }

  @Post()
  @HttpCode(201)
  create(@Body() input: CreateConnectionBody) {
    return this.connectors.createConnection(input);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() input: UpdateConnectionBody) {
    return this.connectors.updateConnection({ connectionId: id, ...input });
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.connectors.deleteConnection({ connectionId: id });
  }

  @Get(':id/mcp-tools')
  listMcpTools(@Param('id') id: string) {
    return this.connectors.listSelectableTools({ connectionId: id });
  }

  @Put(':id/mcp-tools')
  setMcpTools(@Param('id') id: string, @Body() input: SetAllowedToolsBody) {
    return this.connectors.setAllowedTools({ connectionId: id, toolNames: input.toolNames });
  }

  @Post(':id/test')
  test(@Param('id') id: string) {
    return this.connectors.testConnection({ connectionId: id });
  }

  @Post(':id/credentials')
  applyCredentials(@Param('id') id: string, @Body() input: ApplyConnectionCredentialsBody) {
    return this.connectors.applyCredentials(id, input.secrets);
  }

  @Post(':id/credential-link')
  requestCredentials(@Param('id') id: string) {
    return this.connectors.requestCredentials({ connectionId: id });
  }

  @Post(':id/authorize-link')
  authorizeLink(@Param('id') id: string) {
    return this.connectors.authorizeUrl({ connectionId: id });
  }
}
